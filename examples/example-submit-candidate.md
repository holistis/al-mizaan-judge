# Title: Cross-contract reentrancy in withdraw() allows a public attacker to drain the vault

Platform: sherlock
Bug class: reentrancy
Severity: High
Affected file: Vault.sol
Affected function: withdraw
Confidence: 82

## Description
withdraw() sends ETH to the caller via a low-level call before updating the
caller's recorded balance. Any external account (no privileged role required)
can re-enter through a fallback function and withdraw repeatedly before the
balance is ever decremented.

## Impact
Any depositor can drain the entire vault, taking out far more than they
deposited, at the expense of every other depositor.

## Invariant
A user's cumulative withdrawals should never exceed their deposited balance,
and the vault's total balance should never go negative relative to
outstanding deposits.

## Exploit sketch
1. Attacker deploys a contract that deposits 1 ETH into the vault.
2. Attacker's contract calls withdraw(1 ether).
3. The vault sends 1 ETH via a low-level call to the attacker's fallback
   function BEFORE decrementing the attacker's recorded balance.
4. The fallback function calls withdraw(1 ether) again — the balance check
   still passes because it hasn't been decremented yet.
5. Repeat until the vault is drained or gas runs out.

## Code
### Vault.sol
```solidity
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient balance");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        balances[msg.sender] -= amount;
    }
}
```
