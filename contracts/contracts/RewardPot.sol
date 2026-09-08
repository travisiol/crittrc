// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title RewardPot
/// @notice Holds CRITTR (trade fees + half of every hatch fee) and pays it out
///         in weekly windows through Merkle claims.
/// @dev The owner publishes one Merkle root per window with a total budget.
///      Budgets are reserved against the pot's balance so two open windows can
///      never promise the same tokens. Whatever is not claimed before a window
///      closes is released back into the free balance for the next window.
///      Leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
///      (OpenZeppelin StandardMerkleTree, ["address", "uint256"]).
contract RewardPot is Ownable {
    using SafeERC20 for IERC20;

    // ──────────────────────────────── types ──────────────────────────────

    struct Window {
        bytes32 root;
        uint256 total;
        uint256 claimed;
        uint64 opensAt;
        uint64 closesAt;
        bool closed;
    }

    // ──────────────────────────────── state ──────────────────────────────

    /// @notice The reward token (CRITTR).
    IERC20 public immutable token;
    /// @notice Every window ever opened, by id.
    Window[] public windows;
    /// @notice Sum over open windows of (total - claimed). Never loops.
    uint256 public reservedTotal;
    /// @notice Whether `account` has already claimed from window `id`.
    mapping(uint256 windowId => mapping(address account => bool)) public claimed;

    // ─────────────────────────────── events ──────────────────────────────

    event WindowOpened(uint256 indexed id, bytes32 root, uint256 total, uint64 closesAt);
    event Claimed(uint256 indexed windowId, address indexed account, uint256 amount);
    event WindowClosed(uint256 indexed id, uint256 released);

    // ─────────────────────────────── errors ──────────────────────────────

    error ZeroAddress();
    error ZeroRoot();
    error ClosesInPast(uint64 closesAt);
    error InsufficientFree(uint256 requested, uint256 free);
    error UnknownWindow(uint256 id);
    error WindowNotOpen(uint256 id);
    error AlreadyClosed(uint256 id);
    error AlreadyClaimed(uint256 id, address account);
    error InvalidProof();
    error ExceedsWindowTotal(uint256 id);
    error NotYetClosable(uint256 id, uint64 closesAt);

    // ───────────────────────────── constructor ───────────────────────────

    /// @param initialOwner Publishes windows.
    /// @param token_ The CRITTR token.
    constructor(address initialOwner, IERC20 token_) Ownable(initialOwner) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ────────────────────────────── windows ──────────────────────────────

    /// @notice Opens a claim window. `total` is reserved out of the free balance.
    /// @param root Merkle root of (account, amount) leaves.
    /// @param total Sum of every amount in the tree.
    /// @param closesAt Timestamp after which claims stop and the window can be closed.
    /// @return id The new window id.
    function openWindow(bytes32 root, uint256 total, uint64 closesAt) external onlyOwner returns (uint256 id) {
        if (root == bytes32(0)) revert ZeroRoot();
        if (closesAt <= block.timestamp) revert ClosesInPast(closesAt);
        uint256 available = free();
        if (total > available) revert InsufficientFree(total, available);

        id = windows.length;
        windows.push(
            Window({root: root, total: total, claimed: 0, opensAt: uint64(block.timestamp), closesAt: closesAt, closed: false})
        );
        reservedTotal += total;
        emit WindowOpened(id, root, total, closesAt);
    }

    /// @notice Claims `amount` from window `windowId` for msg.sender.
    /// @param windowId Window to claim from.
    /// @param amount Amount in the leaf for msg.sender.
    /// @param proof Merkle proof for the leaf.
    function claim(uint256 windowId, uint256 amount, bytes32[] calldata proof) external {
        if (windowId >= windows.length) revert UnknownWindow(windowId);
        Window storage w = windows[windowId];
        if (w.closed || block.timestamp >= w.closesAt) revert WindowNotOpen(windowId);
        if (claimed[windowId][msg.sender]) revert AlreadyClaimed(windowId, msg.sender);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        if (!MerkleProof.verifyCalldata(proof, w.root, leaf)) revert InvalidProof();
        if (w.claimed + amount > w.total) revert ExceedsWindowTotal(windowId);

        claimed[windowId][msg.sender] = true;
        w.claimed += amount;
        reservedTotal -= amount;

        token.safeTransfer(msg.sender, amount);
        emit Claimed(windowId, msg.sender, amount);
    }

    /// @notice Closes a window and releases its unclaimed remainder to the free balance.
    /// @dev The owner may close at any time; anyone may close once `closesAt` has passed.
    function closeWindow(uint256 id) external {
        if (id >= windows.length) revert UnknownWindow(id);
        Window storage w = windows[id];
        if (w.closed) revert AlreadyClosed(id);
        if (msg.sender != owner() && block.timestamp < w.closesAt) revert NotYetClosable(id, w.closesAt);

        uint256 released = w.total - w.claimed;
        w.closed = true;
        reservedTotal -= released;
        emit WindowClosed(id, released);
    }

    // ─────────────────────────────── views ───────────────────────────────

    /// @notice Balance not promised to any open window.
    function free() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        return balance > reservedTotal ? balance - reservedTotal : 0;
    }

    /// @notice Number of windows ever opened.
    function windowCount() external view returns (uint256) {
        return windows.length;
    }

    /// @notice Whether `account` already claimed from window `id`.
    function isClaimed(uint256 id, address account) external view returns (bool) {
        return claimed[id][account];
    }

    /// @notice Whether window `id` currently accepts claims.
    function isOpen(uint256 id) external view returns (bool) {
        if (id >= windows.length) return false;
        Window storage w = windows[id];
        return !w.closed && block.timestamp < w.closesAt;
    }
}
