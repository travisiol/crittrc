// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ICritterEggs} from "./interfaces/ICritterEggs.sol";

/// @title Hatchery
/// @notice Where a CRITTR fee turns an egg into a critter.
/// @dev The egg owner pays `hatchFee` in CRITTR: `burnBps` of it is burned,
///      the rest goes to the RewardPot. The Hatchery is the only address
///      registered as `hatcher` on CritterEggs, so no egg hatches without
///      passing through here. With `hatchFee == 0` hatching is free.
contract Hatchery is Ownable {
    using SafeERC20 for IERC20;

    // ───────────────────────────── constants ─────────────────────────────

    uint256 public constant BPS = 10_000;

    // ──────────────────────────────── state ──────────────────────────────

    /// @notice The egg collection.
    ICritterEggs public immutable eggs;
    /// @notice The fee token (CRITTR, burnable).
    IERC20 public immutable token;
    /// @notice Receives the non-burned share of every hatch fee (the RewardPot).
    address public pot;
    /// @notice Fee in CRITTR wei to hatch one egg. Zero makes hatching free.
    uint256 public hatchFee = 1000e18;
    /// @notice Share of the fee that is burned, in basis points (default 50%).
    uint256 public burnBps = 5000;

    // ─────────────────────────────── events ──────────────────────────────

    event EggHatched(uint256 indexed tokenId, address indexed by, uint8 indexed species);
    event HatchFeeUpdated(uint256 hatchFee);
    event BurnBpsUpdated(uint256 burnBps);
    event PotUpdated(address indexed previousPot, address indexed newPot);

    // ─────────────────────────────── errors ──────────────────────────────

    error ZeroAddress();
    error NotEggOwner(uint256 tokenId, address caller);
    error AlreadyHatched(uint256 tokenId);
    error BurnBpsTooHigh(uint256 requested, uint256 max);

    // ───────────────────────────── constructor ───────────────────────────

    /// @param initialOwner Owns the contract.
    /// @param eggs_ The CritterEggs collection.
    /// @param token_ The CRITTR token.
    /// @param pot_ The RewardPot.
    constructor(address initialOwner, ICritterEggs eggs_, IERC20 token_, address pot_) Ownable(initialOwner) {
        if (address(eggs_) == address(0) || address(token_) == address(0) || pot_ == address(0)) revert ZeroAddress();
        eggs = eggs_;
        token = token_;
        pot = pot_;
        emit PotUpdated(address(0), pot_);
    }

    // ────────────────────────────── hatching ─────────────────────────────

    /// @notice Hatches `tokenId`, which msg.sender must own. Pulls `hatchFee` CRITTR first.
    /// @param tokenId Egg to hatch.
    /// @return species The rolled species in 1..SPECIES_COUNT.
    function hatch(uint256 tokenId) external returns (uint8 species) {
        if (eggs.ownerOf(tokenId) != msg.sender) revert NotEggOwner(tokenId, msg.sender);
        if (eggs.isHatched(tokenId)) revert AlreadyHatched(tokenId);

        uint256 fee = hatchFee;
        if (fee > 0) {
            token.safeTransferFrom(msg.sender, address(this), fee);
            uint256 burnAmount = (fee * burnBps) / BPS;
            if (burnAmount > 0) {
                ERC20Burnable(address(token)).burn(burnAmount);
            }
            uint256 rest = fee - burnAmount;
            if (rest > 0) {
                token.safeTransfer(pot, rest);
            }
        }

        species = eggs.hatch(tokenId, uint256(uint160(msg.sender)));
        emit EggHatched(tokenId, msg.sender, species);
    }

    // ─────────────────────────────── admin ───────────────────────────────

    /// @notice Sets the CRITTR fee per hatch (0 = free).
    function setHatchFee(uint256 newFee) external onlyOwner {
        hatchFee = newFee;
        emit HatchFeeUpdated(newFee);
    }

    /// @notice Sets the burned share of the fee, in basis points (max 10 000).
    function setBurnBps(uint256 newBurnBps) external onlyOwner {
        if (newBurnBps > BPS) revert BurnBpsTooHigh(newBurnBps, BPS);
        burnBps = newBurnBps;
        emit BurnBpsUpdated(newBurnBps);
    }

    /// @notice Sets the pot that receives the non-burned share.
    function setPot(address newPot) external onlyOwner {
        if (newPot == address(0)) revert ZeroAddress();
        emit PotUpdated(pot, newPot);
        pot = newPot;
    }
}
