// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ICritterEggs
/// @notice The subset of CritterEggs that the Hatchery (and the web app) rely on.
interface ICritterEggs {
    /// @notice Emitted when an egg hatches into a species.
    event Hatched(uint256 indexed tokenId, uint8 indexed species, address indexed owner);

    /// @notice Owner of a token; reverts if the token does not exist.
    function ownerOf(uint256 tokenId) external view returns (address);

    /// @notice 0 while unhatched, 1..SPECIES_COUNT once hatched.
    function speciesOf(uint256 tokenId) external view returns (uint8);

    /// @notice True once `hatch` has been called for the token.
    function isHatched(uint256 tokenId) external view returns (bool);

    /// @notice Rolls the species for `tokenId`. Only the registered hatcher may call.
    /// @param tokenId Egg to hatch.
    /// @param seed Caller-supplied entropy mixed into the roll.
    /// @return species The rolled species id in 1..SPECIES_COUNT.
    function hatch(uint256 tokenId, uint256 seed) external returns (uint8 species);
}
