/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// ============================================================================
// Wallet Constants
// ============================================================================

/**
 * Default preset amount multipliers
 * Used to generate quick select amounts based on minimum topup
 */
export const DEFAULT_PRESET_MULTIPLIERS = [1, 5, 10, 30, 50, 100, 300, 500]

/**
 * Payment method types
 */
export const PAYMENT_TYPES = {
  ALIPAY: 'alipay',
  WECHAT: 'wxpay',
  STRIPE: 'stripe',
  CREEM: 'creem',
  WAFFO: 'waffo',
  WAFFO_PANCAKE: 'waffo_pancake',
} as const

/**
 * Default payment type
 */
export const DEFAULT_PAYMENT_TYPE = PAYMENT_TYPES.ALIPAY

/**
 * Payment icon colors (HEX format for react-icons)
 */
export const PAYMENT_ICON_COLORS = {
  [PAYMENT_TYPES.ALIPAY]: '#1677FF',
  [PAYMENT_TYPES.WECHAT]: '#07C160',
  [PAYMENT_TYPES.STRIPE]: '#635BFF',
  [PAYMENT_TYPES.CREEM]: '#6366F1',
  [PAYMENT_TYPES.WAFFO]: '#2563EB',
  [PAYMENT_TYPES.WAFFO_PANCAKE]: '#F97316',
} as const

/**
 * Default discount rate (no discount)
 */
export const DEFAULT_DISCOUNT_RATE = 1.0

/**
 * Default minimum topup amount
 */
export const DEFAULT_MIN_TOPUP = 1

/**
 * Official shop for purchasing redemption codes (蓝点小铺).
 * Shown in wallet even when online payment gateways are disabled.
 */
export const REDEMPTION_SHOP_URL = 'https://pay.ldxp.cn/shop/MX9C4B03'

/**
 * Customer support QQ group number
 */
export const SUPPORT_QQ_GROUP = '949531417'

export const SUPPORT_QQ_GROUP_URL = `https://qm.qq.com/q/${SUPPORT_QQ_GROUP}`
