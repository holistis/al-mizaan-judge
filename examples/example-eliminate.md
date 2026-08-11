# Title: Security Council can inject arbitrary spoke netAum via onReport()

Platform: sherlock
Bug class: business-logic
Severity: High
Affected file: CrossChainAccountant.sol
Affected function: onReport
Confidence: 85

## Description
The Security Council can call onReport() and submit any netAum value for any
registered spoke chain, with no bounds check against the previous reported value
or any external verification.

## Impact
Complete drain of all depositor assets, since the accounting layer trusts
whatever netAum the Security Council reports.

## Invariant
Total accounted assets should never exceed actual custodied assets.

## Exploit sketch
1. Security Council calls onReport() with a crafted payload setting netAum to
   the maximum uint256 value for a spoke chain.
2. Security Council calls updateTotalAum(), which reads the inflated netAum.
3. Attacker (or the Security Council itself) withdraws against the inflated
   total, draining real assets from other chains' deposits.

## Code
### CrossChainAccountant.sol
```solidity
contract CrossChainAccountant {
    mapping(uint32 => uint256) public spokeNetAum;
    address public securityCouncil;

    modifier onlySC() {
        require(msg.sender == securityCouncil, "not SC");
        _;
    }

    function onReport(uint32 spokeId, uint256 netAum) external onlySC {
        spokeNetAum[spokeId] = netAum;
    }

    function updateTotalAum() external {
        uint256 total;
        for (uint32 i = 0; i < spokeCount; i++) {
            total += spokeNetAum[i];
        }
        totalAum = total;
    }
}
```
