// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Payout
/// @notice The everyday earning path: the game server signs how much CRITTR an
///         account has earned in total, the player claims the difference here.
/// @dev The server keeps gold off chain. When a player cashes out, the server
///      signs an EIP-712 `Claim(account, cumulative, deadline)` voucher where
///      `cumulative` is the running total of CRITTR that account has ever been
///      entitled to — not the amount of this cash-out. `claim` pays
///      `cumulative - claimed[account]` and stores the new cumulative, so:
///
///        * vouchers are idempotent — re-submitting one reverts with
///          "Payout: nothing to claim", which is the whole replay defence.
///          There is no nonce and none is needed;
///        * a lost voucher costs nothing, the next one supersedes it;
///        * out-of-order delivery is safe, an older (lower) cumulative reverts.
///
///      Unlike `RewardPot` (Merkle windows, still available as a batch tool)
///      nothing is reserved here: the contract simply pays out of its balance,
///      which is fed by the CRITTR trade fee (`token.setPot(payout)`), by the
///      Hatchery's share of every hatch fee, and by plain transfers. There is
///      no deposit function — send the token to this address.
///
///      Reverts here are strings rather than the custom errors used elsewhere
///      in this package: they are read verbatim by the game client and server.
contract Payout is Ownable, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────── constants ─────────────────────────────

    /// @notice EIP-712 type hash for `Claim(address account,uint256 cumulative,uint256 deadline)`.
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(address account,uint256 cumulative,uint256 deadline)");

    // ──────────────────────────────── state ──────────────────────────────

    /// @notice The payout token (CRITTR).
    IERC20 public immutable token;
    /// @notice The game's voucher signer. Anything it signs is payable.
    address public signer;
    /// @notice While true, `claim` is closed. Deposits and `rescue` still work.
    bool public paused;

    /// @notice Cumulative CRITTR already paid to `account`.
    mapping(address account => uint256 cumulative) public claimed;
    /// @notice Sum of every payout ever made by this contract.
    uint256 public totalClaimed;

    // ─────────────────────────────── events ──────────────────────────────

    event Claimed(address indexed account, uint256 paid, uint256 cumulative);
    event SignerChanged(address indexed previousSigner, address indexed newSigner);
    event PausedSet(bool paused);
    event Rescued(address indexed to, uint256 amount);

    // ───────────────────────────── constructor ───────────────────────────

    /// @param token_ The CRITTR token paid out to players.
    /// @param signer_ The game server's voucher signer (see `setSigner`).
    /// @param initialOwner Owns the contract: rotates the signer, pauses, rescues.
    constructor(
        IERC20 token_,
        address signer_,
        address initialOwner
    ) Ownable(initialOwner) EIP712("CrittrPayout", "1") {
        require(address(token_) != address(0), "Payout: token is zero");
        require(signer_ != address(0), "Payout: signer is zero");
        token = token_;
        signer = signer_;
        emit SignerChanged(address(0), signer_);
    }

    // ─────────────────────────────── claim ───────────────────────────────

    /// @notice Pays out everything owed to msg.sender up to `cumulative`.
    /// @dev The signature must come from `signer` over the typed data of
    ///      `hashClaim(msg.sender, cumulative, deadline)`. Because the digest
    ///      binds `account`, a voucher issued to one player is worthless in
    ///      anyone else's hands — it simply recovers a different address and
    ///      fails as "bad signature".
    /// @param cumulative Total CRITTR this account has ever earned, in wei.
    /// @param deadline Unix timestamp after which the voucher is dead.
    /// @param signature 65-byte ECDSA signature from `signer`.
    /// @return paid The amount transferred by this call.
    function claim(
        uint256 cumulative,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 paid) {
        require(!paused, "Payout: paused");
        require(block.timestamp <= deadline, "Payout: voucher expired");

        bytes32 digest = hashClaim(msg.sender, cumulative, deadline);
        require(ECDSA.recover(digest, signature) == signer, "Payout: bad signature");

        uint256 already = claimed[msg.sender];
        require(cumulative > already, "Payout: nothing to claim");

        paid = cumulative - already;
        require(token.balanceOf(address(this)) >= paid, "Payout: pot is empty");

        claimed[msg.sender] = cumulative;
        totalClaimed += paid;

        token.safeTransfer(msg.sender, paid);
        emit Claimed(msg.sender, paid, cumulative);
    }

    // ─────────────────────────────── views ───────────────────────────────

    /// @notice The full EIP-712 digest a voucher for these values must be signed over.
    /// @dev Domain: name "CrittrPayout", version "1", this chain, this contract.
    function hashClaim(address account, uint256 cumulative, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, account, cumulative, deadline)));
    }

    /// @notice What `account` would receive from a voucher for `cumulative`.
    /// @dev Returns 0 for a stale voucher instead of reverting, so the client
    ///      can render "nothing to claim" without a try/catch.
    function claimableFor(address account, uint256 cumulative) external view returns (uint256) {
        uint256 already = claimed[account];
        return cumulative > already ? cumulative - already : 0;
    }

    /// @notice CRITTR currently held, i.e. what this contract can still pay.
    function available() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    // ─────────────────────────────── admin ───────────────────────────────

    /// @notice Rotates the voucher signer. Vouchers signed by the old key stop working immediately.
    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Payout: signer is zero");
        emit SignerChanged(signer, newSigner);
        signer = newSigner;
    }

    /// @notice Opens or closes claiming. Use it if the signer key ever leaks.
    function setPaused(bool value) external onlyOwner {
        paused = value;
        emit PausedSet(value);
    }

    /// @notice Moves `amount` CRITTR out of the contract.
    /// @dev Trust point, stated plainly: the owner can withdraw the entire
    ///      balance at any time, including tokens players expect to claim.
    ///      It exists to recover a misconfigured deployment and to retire the
    ///      contract; holders should treat the owner key as fully trusted.
    function rescue(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Payout: to is zero");
        token.safeTransfer(to, amount);
        emit Rescued(to, amount);
    }
}
