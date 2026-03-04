/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'

import { Bundle, Pair, Token } from '../types/schema'
import { ADDRESS_ZERO, factoryContract, ONE_BD, UNTRACKED_PAIRS, ZERO_BD } from './helpers'

// Lux Mainnet (chain 96369) bridge-era deployed token addresses
const WLUX_ADDRESS = '0x4888e4a2ee0f03051c72d2bd3acf755ed3498b3e' // WLUX (native wrapper, 149M supply)
const LUSDC_ADDRESS = '0xf85cf66fd0189c435033056edec5e525f39374a6' // Bridged USDC (1M supply)

// Pair address for WLUX/LUSDC — populated by factory events.
// TODO: Set to the actual deployed pair address once the factory creates it.
const USDC_WLUX_PAIR = '' // will be created when factory creates WLUX/USDC pair

export function getLuxPriceInUSD(): BigDecimal {
  // Derive LUX/USD price from the WLUX/LUSDC pair.
  //
  // V2 price field convention:
  //   token0Price = reserve0 / reserve1 = "how many token0 per 1 token1"
  //   token1Price = reserve1 / reserve0 = "how many token1 per 1 token0"
  //
  // We want: USD per 1 WLUX.
  //   If WLUX is token0: token1Price = stablecoin per WLUX = USD per LUX ✓
  //   If WLUX is token1: token0Price = stablecoin per WLUX = USD per LUX ✓

  if (USDC_WLUX_PAIR != '') {
    let usdcPair = Pair.load(USDC_WLUX_PAIR)
    if (usdcPair !== null) {
      if (usdcPair.token0 == WLUX_ADDRESS) {
        return usdcPair.token1Price // stablecoin per WLUX = USD per LUX
      } else {
        return usdcPair.token0Price // stablecoin per WLUX = USD per LUX
      }
    }
  }
  return ZERO_BD
}

// Backward-compatible alias
export function getEthPriceInUSD(): BigDecimal {
  return getLuxPriceInUSD()
}

// Lux Mainnet tokens that should contribute to tracked volume and liquidity
// All addresses are bridge-era (real, verified on-chain)
let WHITELIST: string[] = [
  '0x4888e4a2ee0f03051c72d2bd3acf755ed3498b3e', // WLUX (149M supply)
  '0xf85cf66fd0189c435033056edec5e525f39374a6', // USDC Bridged (1M supply)
  '0x60e0a8167fc13de89348978860466c9cec24b9ba', // LETH (1.81 supply)
  '0x1e48d32a4f5e9f08db9ae4959163300faf8a6c8e', // LBTC (0.01 supply)
  '0x848cff46eb323f323b6bbe1df274e40793d7f2c2', // LUSD (355.89 supply)
  '0x26b40f650156c7ebf9e087dd0dca181fe87625b7', // LSOL (18.11 supply)
  '0x5e5290f350352768bd2bfc59c2da15dd04a7cb88', // LZOO (10.8B supply)
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('100')

// minimum liquidity for price to get tracked (in LUX terms)
let MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('0.01')

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id == WLUX_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair === null) {
        continue
      }
      if (pair.token0 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token1 = Token.load(pair.token1)
        if (token1 === null) {
          continue
        }
        return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
      }
      if (pair.token1 == token.id && pair.reserveETH.gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)) {
        let token0 = Token.load(pair.token0)
        if (token0 === null) {
          continue
        }
        return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair,
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1)).div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
