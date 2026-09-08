// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721, IERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ICritterEggs} from "./interfaces/ICritterEggs.sol";

/// @title CritterEggs
/// @notice 1111 eggs that hatch into one of six critter species.
/// @dev Minting is a public ETH sale with a per-wallet cap plus an owner mint
///      for team/marketing. Hatching is delegated to a single `hatcher`
///      address (the Hatchery contract), which is where the CRITTR fee is paid.
///      Species are rolled onchain from `block.prevrandao`, the caller seed and
///      the token id — good enough for cosmetics, not for anything adversarial.
contract CritterEggs is ERC721Enumerable, Ownable, ICritterEggs {
    using Strings for uint256;

    // ───────────────────────────── constants ─────────────────────────────

    /// @notice Hard cap on the collection, public sale and owner mint combined.
    uint256 public constant MAX_SUPPLY = 1111;
    /// @notice Number of species an egg can hatch into (ids 1..SPECIES_COUNT).
    uint8 public constant SPECIES_COUNT = 6;

    // ──────────────────────────────── state ──────────────────────────────

    /// @notice Price of one egg in wei. Zero makes the sale free.
    uint256 public price;
    /// @notice Maximum number of eggs a wallet may mint through `mint`.
    uint256 public maxPerWallet = 5;
    /// @notice Whether `mint` is currently allowed.
    bool public saleOpen;
    /// @notice The only address allowed to call `hatch` (the Hatchery).
    address public hatcher;

    /// @notice Species per token: 0 = unhatched, 1..SPECIES_COUNT = hatched.
    mapping(uint256 tokenId => uint8 species) public speciesOf;
    /// @notice Eggs minted per wallet through the public sale (owner mints excluded).
    mapping(address account => uint256 count) public mintedBy;

    string private _baseTokenURI;
    string private _contractURI;
    uint256 private _nextId = 1;

    // ─────────────────────────────── events ──────────────────────────────

    event PriceUpdated(uint256 price);
    event MaxPerWalletUpdated(uint256 maxPerWallet);
    event SaleOpenUpdated(bool open);
    event HatcherUpdated(address indexed previousHatcher, address indexed newHatcher);
    event BaseURIUpdated(string baseURI);
    event ContractURIUpdated(string contractURI);
    event Withdrawn(address indexed to, uint256 amount);

    // ─────────────────────────────── errors ──────────────────────────────

    error SaleClosed();
    error ZeroQuantity();
    error MaxSupplyExceeded(uint256 requested, uint256 remaining);
    error WalletCapExceeded(uint256 requested, uint256 remaining);
    error WrongPayment(uint256 sent, uint256 expected);
    error NotHatcher();
    error AlreadyHatched(uint256 tokenId);
    error WithdrawFailed();

    // ───────────────────────────── constructor ───────────────────────────

    /// @param initialOwner Owns the contract; receives `withdraw()` proceeds.
    constructor(address initialOwner) ERC721("Critter Eggs", "EGG") Ownable(initialOwner) {}

    // ────────────────────────────── minting ──────────────────────────────

    /// @notice Public sale. Pays exactly `price * qty` and mints `qty` sequential eggs.
    /// @param qty Number of eggs to mint (1..maxPerWallet minus already minted).
    function mint(uint256 qty) external payable {
        if (!saleOpen) revert SaleClosed();
        if (qty == 0) revert ZeroQuantity();

        uint256 already = mintedBy[msg.sender];
        if (already + qty > maxPerWallet) revert WalletCapExceeded(qty, maxPerWallet - already);

        uint256 expected = price * qty;
        if (msg.value != expected) revert WrongPayment(msg.value, expected);

        mintedBy[msg.sender] = already + qty;
        _mintBatch(msg.sender, qty);
    }

    /// @notice Owner mint for team / marketing. Ignores the sale flag and the wallet cap.
    /// @param to Recipient of the eggs.
    /// @param qty Number of eggs to mint.
    function ownerMint(address to, uint256 qty) external onlyOwner {
        if (qty == 0) revert ZeroQuantity();
        _mintBatch(to, qty);
    }

    function _mintBatch(address to, uint256 qty) internal {
        uint256 mintedSoFar = _nextId - 1;
        if (mintedSoFar + qty > MAX_SUPPLY) revert MaxSupplyExceeded(qty, MAX_SUPPLY - mintedSoFar);

        uint256 id = _nextId;
        _nextId = id + qty;
        for (uint256 i = 0; i < qty; ++i) {
            _safeMint(to, id + i);
        }
    }

    /// @notice Number of eggs minted so far (owner mints included).
    function minted() external view returns (uint256) {
        return _nextId - 1;
    }

    /// @notice Sends the whole ETH balance to the owner.
    function withdraw() external onlyOwner {
        uint256 amount = address(this).balance;
        (bool ok, ) = payable(owner()).call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(owner(), amount);
    }

    // ────────────────────────────── hatching ─────────────────────────────

    /// @inheritdoc ICritterEggs
    function hatch(uint256 tokenId, uint256 seed) external returns (uint8 species) {
        if (msg.sender != hatcher) revert NotHatcher();
        address tokenOwner = ownerOf(tokenId); // reverts for a non-existent token
        if (speciesOf[tokenId] != 0) revert AlreadyHatched(tokenId);

        species = uint8(
            uint256(keccak256(abi.encodePacked(seed, tokenId, block.prevrandao, block.timestamp))) % SPECIES_COUNT
        ) + 1;
        speciesOf[tokenId] = species;
        emit Hatched(tokenId, species, tokenOwner);
    }

    /// @inheritdoc ICritterEggs
    function isHatched(uint256 tokenId) external view returns (bool) {
        return speciesOf[tokenId] != 0;
    }

    /// @notice Every token id held by `account`, in enumeration order.
    function tokensOf(address account) external view returns (uint256[] memory ids) {
        uint256 n = balanceOf(account);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = tokenOfOwnerByIndex(account, i);
        }
    }

    // ────────────────────────────── metadata ─────────────────────────────

    /// @notice `baseURI + "egg"` while unhatched, `baseURI + tokenId` once hatched.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        string memory base = _baseTokenURI;
        if (speciesOf[tokenId] == 0) {
            return string.concat(base, "egg");
        }
        return string.concat(base, tokenId.toString());
    }

    /// @notice Collection-level metadata (OpenSea style).
    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    /// @notice Current metadata base URI.
    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ─────────────────────────────── admin ───────────────────────────────

    /// @notice Sets the price in wei for one egg.
    function setPrice(uint256 newPrice) external onlyOwner {
        price = newPrice;
        emit PriceUpdated(newPrice);
    }

    /// @notice Sets the per-wallet cap for the public sale.
    function setMaxPerWallet(uint256 newMax) external onlyOwner {
        maxPerWallet = newMax;
        emit MaxPerWalletUpdated(newMax);
    }

    /// @notice Opens or closes the public sale.
    function setSaleOpen(bool open) external onlyOwner {
        saleOpen = open;
        emit SaleOpenUpdated(open);
    }

    /// @notice Sets the address allowed to hatch eggs (the Hatchery).
    function setHatcher(address newHatcher) external onlyOwner {
        emit HatcherUpdated(hatcher, newHatcher);
        hatcher = newHatcher;
    }

    /// @notice Sets the metadata base URI (include the trailing slash).
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    /// @notice Sets the collection-level metadata URI.
    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    // ───────────────────────────── overrides ─────────────────────────────

    function ownerOf(uint256 tokenId) public view override(ERC721, IERC721, ICritterEggs) returns (address) {
        return super.ownerOf(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
