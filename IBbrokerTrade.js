// 模块导入
const mongoose = require("mongoose");
const LogMessage = require("./models/LogMessage"); // 引入日志消息模型
const express = require("express");
const Ib = require("ib");
const cors = require("cors");
const app = express();
// 应用和IB客户端初始化

// 定义允许的来源域名
const allowedOrigins = ["https://nhwt.tech", "http://localhost:3000"];

// CORS中间件的配置
const corsOptionsDelegate = function (req, callback) {
  let corsOptions;
  if (allowedOrigins.indexOf(req.header("Origin")) !== -1) {
    corsOptions = { origin: true }; // 允许列出的域名
  } else {
    corsOptions = { origin: false }; // 不允许其他未列出的域名
  }
  callback(null, corsOptions);
};

app.use(cors(corsOptionsDelegate));

const ib = new Ib({
  clientId: 0,
  host: "127.0.0.1",
  port: 4001,
  // 对于TWS，使用端口 7496（实盘）或 7497（模拟）
  // 对于IB Gateway，使用端口 4001（实盘）或 4002（模拟）
});

mongoose.connect("mongodb://localhost:27017/trading_database");

// 修改后的log和logError函数
function log(...messages) {
  const message = messages.join(" ");
  console.log(message); // 在控制台输出
  const logEntry = new LogMessage({ message }); // 创建一个新的日志条目
  logEntry.save(); // 保存到数据库
}

function logError(message) {
  console.error(message); // 在控制台输出错误
  const logEntry = new LogMessage({ message }); // 创建一个新的日志条目
  logEntry.save(); // 保存到数据库
}
// 设置交易合约
const contract = {
  symbol: "TQQQ",
  secType: "STK",
  exchange: "SMART",
  primaryExch: "NASDAQ",
  currency: "USD",
};
const accounts = ["U10823590", "U11770168"]; // 单账户测试成功 LUMEI
//const accounts = ["DU8200565", "DU8200566", "DU8200568"];

let stockPrice = 66;
let lastBuyStockPrice = 66; //极度重要
let nextOrderId = null;
let accountSummary = {};

// 当IB客户端从服务器断开连接时，尝试重新连接
ib.on("disconnected", () => {
  attemptReconnect("与Interactive Brokers的连接已断开");
});

let reconnectDelay = 5000; // 初始重连延迟设为5秒
const maxDelay = 120000; // 最大延迟时间设为2分钟
let lastLoggedDelay = 0; // 上一次记录的延迟时间，初始设置为0

function attemptReconnect(errorMessage) {
  let newDelay = Math.min(reconnectDelay * 2, maxDelay); // 计算新的重连延迟
  setTimeout(() => {
    if (newDelay !== lastLoggedDelay) {
      // 仅当新的延迟时间与上次记录的不同时记录日志
      logError(
        `尝试重新连接，当前重连延迟为: ${(newDelay / 1000).toFixed(
          1
        )}秒，${errorMessage}`
      );
      lastLoggedDelay = newDelay; // 更新上次记录的延迟时间
    }

    ib.connect(); // 尝试重新连接
  }, reconnectDelay);
  reconnectDelay = newDelay; // 更新重连延迟
}

// 连接到Interactive Brokers
ib.connect()
  .on("error", handleConnectionError) // 处理连接错误
  .on("nextValidId", (orderId) => {
    nextOrderId = orderId;
  }) // 存储下一个有效的订单ID
  .on("managedAccounts", handleManagedAccounts); // 处理管理的账户
// 请求管理的账户信息
ib.reqManagedAccts();
ib.on("updateAccountValue", (key, value) => {
  accountSummary[key] = value;
});

// 处理连接错误
function handleConnectionError(err) {
  if (err.code === "ECONNREFUSED") {
    attemptReconnect(`无法连接到Interactive Brokers: ${err.message}`);
  } else {
    logError(err.message);
  }
}

// 处理管理的账户
function handleManagedAccounts() {
  // 移除旧的监听器
  ib.removeAllListeners("accountSummary");
  ib.removeAllListeners("accountSummaryEnd");
  ib.removeAllListeners("position");
  ib.removeAllListeners("positionEnd");
  ib.reqAccountSummary(
    0, // 使用一个固定的请求ID
    "All",
    "NetLiquidation,TotalCashValue"
  );

  let accountSummaries = {};

  ib.on("accountSummary", (reqId, account, tag, value, currency) => {
    if (!accountSummaries[account]) {
      accountSummaries[account] = {};
    }
    accountSummaries[account][tag] = value + " " + currency;
    // 更新全局 accountSummary 对象
    accountSummary[account] = accountSummary[account] || {};
    accountSummary[account][tag] = value;
  });

  ib.once("accountSummaryEnd", () => {
    // 遍历并打印每个账户的摘要
    for (let account in accountSummaries) {
      const summary = accountSummaries[account];
      log(
        `摘要 - 账户: ${account}, NetLiquidation: ${summary.NetLiquidation}, TotalCashValue: ${summary.TotalCashValue}`
      );
    }
    // 清空临时存储结构以便于下次请求
    accountSummaries = {};
    // 移除账户摘要相关的监听器
    ib.removeAllListeners(["accountSummary", "accountSummaryEnd"]);
  });

  // 请求持仓信息
  ib.reqPositions();

  // 处理持仓信息
  ib.on("position", (account, contract, position, avgCost) => {
    log(
      `持仓信息 - 账户: ${account}, 合约: ${contract.symbol}, 仓位: ${position}, 平均成本: ${avgCost}`
    );
  });
  // 处理持仓结束
  ib.once("positionEnd", (account) => {
    log(
      "====================== 所有账户的持仓信息已接收完毕 ================================"
    );
    ib.removeAllListeners(["position", "positionEnd"]);
  });
}

// 检查TotalCashValue是否更新
function checkTotalCashValueUpdated(account) {
  // 检查账户摘要是否存在，以及是否包含TotalCashValue
  return new Promise(async (resolve, reject) => {
    if (
      !accountSummary[account] ||
      !accountSummary[account]["TotalCashValue"]
    ) {
      logError(
        `账户 ${account} 的账户摘要未定义或缺少总现金价值。正在请求更新...`
      );
      await requestAccountSummaryUpdate(account);
      resolve(false);
    } else {
      const lastUpdatedTime = accountSummary[account].lastUpdated;
      const now = new Date();
      // 检查TotalCashValue的更新时间是否在过去的一分钟内
      if (lastUpdatedTime && now - lastUpdatedTime < 60000) {
        log(
          `最后更新时间：${lastUpdatedTime}\n总现金价值：${accountSummary[account]["TotalCashValue"]}`
        );
        resolve(true); // TotalCashValue是最新的
      } else {
        log(
          `====================== 正在更新... 账户 ${account} 的TotalCashValue =================================`
        );
        await requestAccountSummaryUpdate(account);
        resolve(accountSummary[account] ? true : false);
      }
    }
  });
}

// 请求更新账户摘要
function requestAccountSummaryUpdate(account) {
  return new Promise((resolve, reject) => {
    ib.cancelAccountSummary(0);
    ib.reqAccountSummary(0, "All", "NetLiquidation,TotalCashValue", account);
    ib.once("accountSummaryEnd", () => {
      const totalCashValue = accountSummary[account]
        ? accountSummary[account]["TotalCashValue"]
        : "未定义";
      log(
        `账户 ${account} 的摘要已更新。新的TotalCashValue值：${totalCashValue}`
      );
      resolve(!!accountSummary[account]); // 如果accountSummary[account]存在，则解决 Promise 为 true，否则为 false
    });
  });
}

// 获取账户信息
function getAccountInfo(account) {
  // 检查是否已有请求的账户信息
  return new Promise((resolve, reject) => {
    if (accountSummary[account]) {
      // 如果已有信息，直接使用该信息
      resolve(accountSummary[account]);
    } else {
      ib.cancelAccountSummary(0);
      ib.reqAccountSummary(0, "All", "NetLiquidation,TotalCashValue", account);
      ib.once("accountSummaryEnd", () => {
        // 收到的账户摘要信息被存储到 accountSummary[account]
        resolve(accountSummary[account] || {});
        log(`账户 ${account} 的摘要信息:`, summary);
      });
    }
  });
}

// 计算基于账户现金价值的交易数量
function calculateQuantityBasedOnAccountInfo(cashValue) {
  if (isNaN(cashValue) || cashValue <= 0) {
    logError("无效的现金价值");
    return 0;
  }

  if (isNaN(stockPrice) || stockPrice <= 0) {
    logError("无效的股票价格");
    return 0;
  }
  const percentageOfCashToUse = 1.25; // 计算仓位杠杆
  const quantity = (cashValue * percentageOfCashToUse) / stockPrice;
  return Math.floor(quantity);
}
//打印未成交的委托单后撤单
function printOpenOrders(account) {
  // log(`====================== 开始对 ${account} 撤单 ======================`);
  return new Promise((resolve, reject) => {
    //   log(`====================== 遍历对 ${account} 撤单 ======================`);
    ib.removeAllListeners("openOrder");
    ib.removeAllListeners("orderStatus");
    ib.removeAllListeners("openOrderEnd");
    let openOrderIds = new Set();
    ib.once("openOrder", (orderId, contract, order, orderState) => {
      if (order.account === account && orderState.status !== "Filled") {
        log(
          `账户 ${order.account} 未成交委托单: 订单号=${orderId}, 合约=${contract.symbol}, 数量=${order.totalQuantity}, 状态=${orderState.status}`
        );
        openOrderIds.add(orderId);
      }
    });

    ib.on("orderStatus", (orderId, status, ...args) => {
      if (status === "Cancelled" && openOrderIds.has(orderId)) {
        log(`委托单已撤销：订单号=${orderId}`);
        openOrderIds.delete(orderId);
        if (openOrderIds.size === 0) {
          resolve();
        }
      }
    });

    ib.once("openOrderEnd", () => {
      if (openOrderIds.size === 0) {
        log(`账户 ${account} 没有未成交的委托单`);
        resolve();
      } else {
        openOrderIds.forEach((orderId) => {
          ib.cancelOrder(orderId);
          log(`尝试撤销委托单：订单号=${orderId}`);
        });
      }
    });

    ib.reqOpenOrders();
  });
}

// 买入开仓
async function buyOrder(account, action) {
  await printOpenOrders(account);
  log(
    `====================== ${account} 开仓前撤单流程完毕 ======================================================`
  );
  // 首先检查并平掉负持仓
  await checkAndCoverNegativePositions(account);
  // log(`首先检查并平掉负持仓 ${account} `);
  // 检查TotalCashValue是否更新
  const isUpdated = await checkTotalCashValueUpdated(account);
  if (!isUpdated) {
    logError(`账户 ${account} 的 TotalCashValue 近期未更新。订单已中止`);
    return;
  }

  // 获取账户信息
  try {
    const accountInfo = await getAccountInfo(account);
    if (!accountInfo || !accountInfo["TotalCashValue"]) {
      logError("无法获取账户信息或TotalCashValue。");
      return;
    }

    const cashValue = accountInfo["TotalCashValue"];
    const quantity = calculateQuantityBasedOnAccountInfo(cashValue);

    if (!isFinite(quantity) || quantity < 1) {
      logError(`账户 ${account}：计算的开仓数量无效或太低`);
      return;
    }

    // 下达买入订单
    const order = {
      action: "BUY",
      orderType: "MKT",
      totalQuantity: quantity,
      transmit: true,
      account: account,
    };
    ib.placeOrder(nextOrderId, contract, order);
    log(
      `====================== 账户 ${account} 订单${nextOrderId}已下：操作=${action}, 数量=${quantity} =============================`
    );

    if (action === "BUY") {
      ib.once("orderStatus", (id, status) => {
        if (id === nextOrderId && status === "Filled") {
          log(`订单 ${id} 成交：购买了 ${quantity} 股 ${contract.symbol}`);
        }
      });
    }

    nextOrderId++;
  } catch (error) {
    logError(`获取账户 ${account} 信息时出错:`, error);
  }
}
//接收到alert触发买入开仓前监听仓位
const globalContract = contract; // 引用全局 contract 对象
function getPositionsForAccount(account) {
  return new Promise((resolve, reject) => {
    const positions = [];
    const positionHandler = (acc, contract, pos, avgCost) => {
      if (acc === account && contract.symbol === globalContract.symbol) {
        positions.push({
          contract: contract,
          position: pos,
          avgCost: avgCost,
        });
      }
    };
    // 监听持仓信息事件
    ib.on("position", positionHandler);
    // 事件处理结束后，清理监听器
    ib.once("positionEnd", () => {
      ib.removeListener("position", positionHandler);
      resolve(positions);
    });
    // 请求持仓信息
    ib.reqPositions();
  });
}

// 接收到alert触发买入开仓逻辑
async function updateAndPlaceOrderIfNoPositions(accounts) {
  for (const account of accounts) {
    // 检查是否有持仓
    const positions = await getPositionsForAccount(account);
    const hasPosition = positions.some(
      (position) =>
        position.contract.symbol === globalContract.symbol &&
        position.position !== 0
    );

    if (!hasPosition) {
      // 如果没有持仓，更新TotalCashValue并下单
      await updateTotalCashValueAndPlaceOrder([account]);
    } else {
      log(
        `账户 ${account} 已有${globalContract.symbol} 的持仓，不执行买入操作`
      );
    }
  }
}

// 首先检查并平掉负持仓
function checkAndCoverNegativePositions(account) {
  // 获取当前持仓
  return new Promise((resolve, reject) => {
    ib.reqPositions();
    ib.on("position", (acc, _contract, position, avgCost) => {
      if (acc === account && position < 0) {
        // 如果持仓是负数，执行买入操作来平掉
        const coverOrder = {
          action: "BUY",
          orderType: "MKT",
          totalQuantity: Math.abs(position),
          transmit: true,
          account: account,
        };
        ib.placeOrder(nextOrderId, contract, coverOrder);
        nextOrderId++;
      }
    });
    ib.once("positionEnd", () => {
      resolve();
    });
  });
}
// 清空所有持有的股票头寸
async function liquidateAllPositions(accounts) {
  let previousPositions = {};

  for (const account of accounts) {
    log(`启动清算账户 ${account} 的所有仓位...`);

    await printOpenOrders(account);
    log(
      `====================== ${account} 清仓前撤单流程完毕 ======================================================`
    );

    // 移除旧的监听器
    ib.removeAllListeners(["position", "positionEnd"]);
    await new Promise((resolve) => {
      ib.reqPositions()
        .on("position", (acc, positionContract, pos, avgCost) => {
          // 使用不同的参数名以避免与外部 account 参数冲突
          if (acc === account && positionContract.secType === "STK") {
            let action; // 在这里声明action
            if (pos > 0) {
              action = "SELL";
            } else if (pos < 0) {
              action = "BUY";
            } else {
              log(`账户 ${acc} 没有持仓需要平仓`);
              return; // 直接返回，不执行下面的操作
            }
            let totalQuantity = Math.abs(pos);
            const order = {
              action: action,
              orderType: "MKT",
              totalQuantity: totalQuantity,
              totalQuantity: totalQuantity,
              transmit: true,
              account: acc,
            };
            log(
              `====================== 启动平仓流程 账户 ${acc} 准备${
                action === "SELL" ? "出售" : "购买"
              }，总数量：${totalQuantity}，合约：${
                positionContract.symbol
              } ======================`
            );
            ib.placeOrder(nextOrderId, contract, order);
            nextOrderId++;
          }
        })
        .once("positionEnd", () => {
          // log(`账户 ${account} 的所有仓位清算已启动`);
          // 重新请求持仓，确认清仓后的状态
          ib.removeAllListeners(["position", "positionEnd"]);
          ib.reqPositions()
            .on("position", (acc, contract, pos, avgCost) => {
              // 打印当前处理的账户标识
              // log(`当前处理的账户: ${acc}`);
              if (accounts.includes(acc) && contract.secType === "STK") {
                const contractId = contract.symbol;
                const currency = contract.currency; // 确保contract对象包含currency字段
                // 确保每个账户有自己的持仓跟踪
                if (!previousPositions[acc]) {
                  previousPositions[acc] = {};
                }
                // 如果发生了变化，则打印和更新
                if (
                  !previousPositions[acc][contractId] ||
                  previousPositions[acc][contractId].position !== pos ||
                  previousPositions[acc][contractId].avgCost !== avgCost
                ) {
                  const formattedAvgCost = avgCost.toFixed(2);
                  // 仅当检测到变化时打印
                  log(
                    `账户 ${acc} 最新剩余仓位：${contract.symbol}，数量=${pos}，平均成本=${formattedAvgCost}(${currency})`
                  );
                  // 更新跟踪对象中的持仓信息
                  previousPositions[acc][contractId] = {
                    position: pos,
                    avgCost: avgCost,
                  };
                }
              }
            })
            .once("positionEnd", () => {
              // 持仓信息处理完成
              resolve();
            });
        });
    });
  }
}

// 更新TotalCashValue并下单
async function updateTotalCashValueAndPlaceOrder(accounts) {
  // 取消之前的账户摘要订阅
  for (const account of accounts) {
    await new Promise((resolve) => {
      ib.cancelAccountSummary(0); // 取消之前的账户摘要订阅
      ib.reqAccountSummary(0, "All", "NetLiquidation,TotalCashValue", account);
      ib.once("accountSummaryEnd", async () => {
        log(
          `特定账户 ${account} 的 TotalCashValue:`,
          accountSummary[account]
            ? accountSummary[account]["TotalCashValue"]
            : "未定义"
        );
        if (
          accountSummary[account] &&
          accountSummary[account]["TotalCashValue"]
        ) {
          try {
            await buyOrder(account, "BUY"); // 等待buyOrder函数完成
          } catch (error) {
            logError(`处理账户 ${account} 时出错:`, error);
          }
        } else {
          logError("更新TotalCashValue失败。无法下订单");
        }
        resolve(); // 确保在事件处理完成后解决 Promise
      });
    });
  }
}

// Express应用设置和路由
app.use(express.json());

// ======================================Webhook 处理=====================================
let isLocked = false;
let lockReason = "";
app.post("/webhook", async (req, res) => {
  try {
    log("账户组: ", accounts);
    const data = req.body;
    const hongKongTime = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Hong_Kong",
    });
    const newYorkTime = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
    });
    log(
      `接收到的 Webhook 数据:\n${JSON.stringify(
        data,
        null,
        2
      )}\n香港时间: ${hongKongTime}\n纽约时间: ${newYorkTime}`
    );
    // 锁定判断条件
    const shouldLock =
      data.action === "buy" ||
      data.action === "sell" ||
      data.alertId === "ab32a49f-fb8a-4628-b181-2aee50f669ce" ||
      data.alertId === "a1d7f97e-69ca-48ff-a664-25a6f3cde9c4";

    if (isLocked) {
      log("锁定4秒内种。锁定原因：4秒内接收到过" + lockReason);
      return;
    }

    if (shouldLock) {
      isLocked = true;
      lockReason = `Action: ${data.action}, Alert ID: ${data.alertId}`;
      setTimeout(() => {
        isLocked = false;
        lockReason = "";
        log("操作锁定已解除");
      }, 4000); // 4秒后解锁
    }

    // 根据条件处理买入或卖出操作
    if (
      data.action !== "buy" &&
      data.alertId === "ab32a49f-fb8a-4628-b181-2aee50f669ce"
    ) {
      log(`收到特定 alertId 触发的买入操作: ${data.alertId}`);
      stockPrice = lastBuyStockPrice * 1.05; // 使用最后一个buy webhook的stockPrice乘以110%，这个原因是保证股价可以成功开仓，这不是杠杆倍数
      await updateAndPlaceOrderIfNoPositions(accounts);
      return;
    } else if (
      data.action !== "sell" &&
      data.alertId === "a1d7f97e-69ca-48ff-a664-25a6f3cde9c4"
    ) {
      log(`收到特定 alertId 触发的清仓操作: ${data.alertId}`);
      await liquidateAllPositions(accounts);
      return;
    }

    // 更新股票价格
    if (data.price) {
      stockPrice = data.price;
      lastBuyStockPrice = data.price; // 更新最后一个buy webhook的stockPrice
    }

    // 验证数据有效性
    if (stockPrice <= 0) {
      log("无法下单：无效的订单ID或股票价格。");
      res.status(400).send("Invalid order ID or stock price");
      return;
    }

    // 处理每个账户
    switch (data.action) {
      case "buy":
        // 如果动作为购买
        await updateTotalCashValueAndPlaceOrder(accounts);
        break;
      case "sell":
        // 如果动作为卖出
        await liquidateAllPositions(accounts);
        break;
      default:
        log("未知操作");
        res.status(400).send("Unknown action");
        return;
    }
    res.status(200).send("Webhook received and action processed");
  } catch (error) {
    logError(`处理Webhook时出错：${error.message}`);
    res.status(500).send("Internal Server Error");
  }
});

// 设置监听端口并启动服务器
const port = 80;
app.listen(port, () => {
  log(`Webhook 服务器正在运行在端口 ${port}`);
});
