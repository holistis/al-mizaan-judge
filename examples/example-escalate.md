# Title: Oracle silently falls back to manipulable Uniswap V3 TWAP during Chainlink downtime

Platform: sherlock
Bug class: oracle-manipulation
Severity: High
Affected file: PriceOracle.sol
Affected function: getPrice
Confidence: 80

## Description
When the Chainlink feed reverts due to staleness, the oracle silently falls
back to a Uniswap V3 TWAP price with no deviation check against the last known
good price.

## Impact
An attacker can manipulate the TWAP during a Chainlink outage window, causing
the protocol to mis-price collateral and either accumulate bad debt or
liquidate solvent borrowers.

## Invariant
Protocol solvency should be preserved even during an oracle outage.

## Exploit sketch
1. Wait for (or induce) a Chainlink staleness window.
2. Manipulate the Uniswap V3 pool price over the TWAP window using a flash loan.
3. Trigger a liquidation or borrow against the manipulated price.

## Code
### PriceOracle.sol
```solidity
contract PriceOracle {
    AggregatorV3Interface public chainlinkFeed;
    IUniswapV3Pool public uniPool;
    uint32 public twapWindow = 1800;

    function getPrice() external view returns (uint256) {
        try chainlinkFeed.latestRoundData() returns (
            uint80, int256 answer, uint256, uint256 updatedAt, uint80
        ) {
            if (block.timestamp - updatedAt < 3600 && answer > 0) {
                return uint256(answer);
            }
        } catch {}

        // Falls back to TWAP with no deviation check against last good price.
        return getUniswapTwap(uniPool, twapWindow);
    }
}
```
