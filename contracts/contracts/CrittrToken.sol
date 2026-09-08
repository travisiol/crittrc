// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CrittrToken
/// @notice CRITTR — fixed-supply ERC20 with a buy/sell fee routed to the RewardPot.
/// @dev A fee is taken only on transfers that touch exactly one registered AMM
///      pair: pair -> wallet is a buy, wallet -> pair is a sell. Wallet-to-wallet
///      and pair-to-pair transfers are free, as is anything involving a
///      fee-exempt address. The fee lands in `pot` as plain CRITTR balance,
///      which the RewardPot then distributes through weekly Merkle windows.
contract CrittrToken is ERC20, ERC20Burnable, Ownable {
    // ───────────────────────────── constants ─────────────────────────────

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant BPS = 10_000;
    /// @notice Hard cap on the trade fee: 5%.
    uint256 public constant MAX_FEE_BPS = 500;

    // ──────────────────────────────── state ──────────────────────────────

    /// @notice Trade fee in basis points (default 3%).
    uint256 public feeBps = 300;
    /// @notice Receives every fee (the RewardPot). Zero disables fees.
    address public pot;

    /// @notice Registered AMM pairs / pools.
    mapping(address account => bool) public isPair;
    /// @notice Addresses that never pay the fee on either side.
    mapping(address account => bool) public feeExempt;

    // ─────────────────────────────── events ──────────────────────────────

    event FeeTaken(address indexed from, address indexed to, uint256 fee);
    event FeeBpsUpdated(uint256 feeBps);
    event PotUpdated(address indexed previousPot, address indexed newPot);
    event PairUpdated(address indexed pair, bool isPair);
    event FeeExemptUpdated(address indexed account, bool exempt);

    // ─────────────────────────────── errors ──────────────────────────────

    error ZeroAddress();
    error FeeTooHigh(uint256 requested, uint256 max);

    // ───────────────────────────── constructor ───────────────────────────

    /// @param initialOwner Owns the contract. The whole supply goes to the deployer (msg.sender).
    constructor(address initialOwner) ERC20("Crittr", "CRITTR") Ownable(initialOwner) {
        _setFeeExempt(initialOwner, true);
        _setFeeExempt(msg.sender, true);
        _setFeeExempt(address(this), true);
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    // ─────────────────────────────── admin ───────────────────────────────

    /// @notice Registers or unregisters an AMM pair.
    function setPair(address pair, bool value) external onlyOwner {
        if (pair == address(0)) revert ZeroAddress();
        isPair[pair] = value;
        emit PairUpdated(pair, value);
    }

    /// @notice Sets the trade fee. Capped at MAX_FEE_BPS.
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh(newFeeBps, MAX_FEE_BPS);
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    /// @notice Sets the fee receiver. The new pot is made fee-exempt automatically.
    function setPot(address newPot) external onlyOwner {
        emit PotUpdated(pot, newPot);
        pot = newPot;
        if (newPot != address(0)) _setFeeExempt(newPot, true);
    }

    /// @notice Exempts (or un-exempts) an account from the fee on both sides.
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        _setFeeExempt(account, exempt);
    }

    function _setFeeExempt(address account, bool exempt) internal {
        feeExempt[account] = exempt;
        emit FeeExemptUpdated(account, exempt);
    }

    // ────────────────────────────── transfer ─────────────────────────────

    /// @dev Splits `value` into fee -> pot and remainder -> to when the transfer
    ///      is a buy or a sell. Mints and burns never touch a pair, so they pass through.
    function _update(address from, address to, uint256 value) internal override {
        bool fromPair = isPair[from];
        bool toPair = isPair[to];
        bool takeFee = (fromPair != toPair) &&
            pot != address(0) &&
            feeBps > 0 &&
            !feeExempt[from] &&
            !feeExempt[to];

        if (!takeFee) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / BPS;
        if (fee > 0) {
            super._update(from, pot, fee);
            emit FeeTaken(from, to, fee);
        }
        super._update(from, to, value - fee);
    }
}
