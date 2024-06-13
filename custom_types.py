from typing import TypedDict, Optional, Union, Dict, List, Literal


class CURRENCY_BALANCE(TypedDict, total=False):
    free: float    # float, money available for trading
    used: float    # float, money on hold, locked, frozen, or pending
    total: float   # float, total balance (free + used)


class BALANCE(TypedDict, total=False):
    info: Union[dict, str]          # the original untouched non-parsed reply with details
    timestamp: int                  # Unix Timestamp in milliseconds (seconds * 1000)
    datetime: str                   # ISO8601 datetime string with milliseconds

    # indexed by availability of funds first, then by currency
    free: Dict[str, float]          # money, available for trading, by currency
    used: Dict[str, float]          # money on hold, locked, frozen, or pending, by currency
    total: Dict[str, float]         # total (free + used), by currency

    # indexed by currency first, then by availability of funds
    BTC: CURRENCY_BALANCE            # dictionary for BTC currency
    USD: CURRENCY_BALANCE            # dictionary for USD currency
    # You can add other currencies similarly as needed


class CANDLE(TypedDict):
    timestamp: int     # UTC timestamp in milliseconds, integer
    open: float        # Open price, float
    high: float        # Highest price, float
    low: float         # Lowest price, float
    close: float       # Closing price, float
    volume: float      # Volume float


class FEE(TypedDict):
    currency: str   # which currency the fee is (usually quote)
    cost: float     # the fee amount in that currency
    rate: float     # the fee rate (if available)


class ORDER (TypedDict, total=False):
    id: int                      # 主键
    user_id: int                 # 用户id
    plan_id: int                 # 实盘id
    strategy_type: str           # 策略类型
    datetime: str                # 时间
    symbol: str                  # 标的
    type: str                    # 价格类型, 'market', 'limit'
    side: str                    # 买卖方向, 'buy', 'sell'
    reduceOnly: str              # 是否为仅平仓
    price: float                 # 下单价格
    amount: float                # 下单数量
    profit: float                # 利润（回测使用）
    profit_rate: float           # 利润率（回测使用）
    asset: float                 # 资产（回测使用）
    asset_rate: float            # 增长率（回测使用）
    status: str                  # 订单状态, 'open', 'closed', 'canceled', 'expired', 'rejected'
    filled: float                # 成交数量
    remaining: float             # 未成交数量
    average: float               # 成交均价
    cost: float                  # 花费金额
    fee: FEE                     # 交易费用
    fees: Union[dict, str]       # 交易费用
    trades: Union[list, str]     # 成交信息
    stopPrice: float             # 停止价格
    postOnly: Optional[bool]     # 是否仅挂单
    timeInForce: float           # 下单策略, 'GTC', 'IOC', 'FOK', 'PO'
    timestamp: int               # 下单时间戳
    lastTradeTimestamp: int      # 最后成交时间
    lastUpdateTimestamp: int     # 最后刷新时间
    orderId: str                 # 订单id
    clientOrderId: str           # 自定义订单id
    info: Union[dict, str]       # 原生订单信息
    extra: Union[dict, str]      # 额外参数
    createTime: int              # 生成时间
    updateTime: int              # 刷新时间


class POSITION(TypedDict, total=False):
    info: Union[dict, str]                         # json response returned from the exchange as is
    id: str                                        # string, position id to reference the position, similar to an order id
    symbol: str                                    # uppercase string literal of a pair of currencies
    timestamp: int                                 # integer unix time since 1st Jan 1970 in milliseconds
    datetime: str                                  # ISO8601 representation of the unix time above
    isolated: bool                                 # boolean, whether or not the position is isolated, as opposed to cross where margin is added automatically
    hedged: bool                                   # boolean, whether or not the position is hedged, i.e. if trading in the opposite direction will close this position or make a new one
    side: Literal['long', 'short']                 # string, long or short
    contracts: float                               # float, number of contracts bought, aka the amount or size of the position
    contractSize: float                            # float, the size of one contract in quote units
    entryPrice: float                              # float, the average entry price of the position
    markPrice: float                               # float, a price that is used for funding calculations
    notional: float                                # float, the value of the position in the settlement currency
    leverage: float                                # float, the leverage of the position, related to how many contracts you can buy with a given amount of collateral
    collateral: float                              # float, the maximum amount of collateral that can be lost, affected by pnl
    initialMargin: float                           # float, the amount of collateral that is locked up in this position
    maintenanceMargin: float                       # float, the minimum amount of collateral needed to avoid being liquidated
    initialMarginPercentage: float                 # float, the initialMargin as a percentage of the notional
    maintenanceMarginPercentage: float             # float, the maintenanceMargin as a percentage of the notional
    unrealizedPnl: float                           # float, the difference between the market price and the entry price times the number of contracts, can be negative
    liquidationPrice: float                        # float, the price at which collateral becomes less than maintenanceMargin
    marginMode: Literal['cross', 'isolated']       # string, can be cross or isolated
    percentage: float                              # float, represents unrealizedPnl / initialMargin * 100


class POSITIONS(TypedDict):
    positions: List[POSITION]                      # List of positions

