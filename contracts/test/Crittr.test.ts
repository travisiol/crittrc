import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

/** Whole-token helper: units(1000) = 1000 * 1e18. */
const units = (n: number | string) => ethers.parseUnits(String(n), 18);

const PRICE = ethers.parseEther("0.01");
const HATCH_FEE = units(1000);
const WEEK = 7 * 24 * 60 * 60;

/**
 * Full stack wired exactly like scripts/deploy.ts:
 *
 *   deployer  holds the 1B supply, fee-exempt
 *   pair      an EOA registered as the AMM pair (buys come from it, sells go to it)
 *   alice/bob hold CRITTR and buy eggs
 */
async function deployFixture() {
  const [deployer, alice, bob, carol, pair, stranger] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("CrittrToken")).deploy(deployer.address);
  const tokenAddress = await token.getAddress();

  const pot = await (await ethers.getContractFactory("RewardPot")).deploy(deployer.address, tokenAddress);
  const potAddress = await pot.getAddress();

  const eggs = await (await ethers.getContractFactory("CritterEggs")).deploy(deployer.address);
  const eggsAddress = await eggs.getAddress();

  const hatchery = await (
    await ethers.getContractFactory("Hatchery")
  ).deploy(deployer.address, eggsAddress, tokenAddress, potAddress);
  const hatcheryAddress = await hatchery.getAddress();

  // Wiring
  await eggs.setHatcher(hatcheryAddress);
  await token.setPot(potAddress);
  await token.setFeeExempt(potAddress, true);
  await token.setFeeExempt(hatcheryAddress, true);
  await token.setPair(pair.address, true);

  await eggs.setPrice(PRICE);
  await eggs.setSaleOpen(true);

  // Inventory (deployer is exempt, so no fee on these)
  await token.transfer(pair.address, units(10_000_000));
  await token.transfer(alice.address, units(100_000));
  await token.transfer(bob.address, units(100_000));

  return {
    deployer,
    alice,
    bob,
    carol,
    pair,
    stranger,
    token,
    tokenAddress,
    pot,
    potAddress,
    eggs,
    eggsAddress,
    hatchery,
    hatcheryAddress,
  };
}

/** Mints `qty` eggs to `signer` through the public sale. */
async function buyEggs(eggs: Awaited<ReturnType<typeof deployFixture>>["eggs"], signer: any, qty: number) {
  await eggs.connect(signer).mint(qty, { value: PRICE * BigInt(qty) });
}

// ═══════════════════════════════════════════════════════════════════════════
describe("CritterEggs", () => {
  it("rejects mint while the sale is closed", async () => {
    const { eggs, alice } = await loadFixture(deployFixture);
    await eggs.setSaleOpen(false);
    await expect(eggs.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(eggs, "SaleClosed");
  });

  it("requires the exact price", async () => {
    const { eggs, alice } = await loadFixture(deployFixture);
    await expect(eggs.connect(alice).mint(2, { value: PRICE }))
      .to.be.revertedWithCustomError(eggs, "WrongPayment")
      .withArgs(PRICE, PRICE * 2n);
    await expect(eggs.connect(alice).mint(1, { value: PRICE * 2n })).to.be.revertedWithCustomError(
      eggs,
      "WrongPayment",
    );
    await expect(eggs.connect(alice).mint(0, { value: 0 })).to.be.revertedWithCustomError(eggs, "ZeroQuantity");
  });

  it("mints sequential ids starting at 1 and reports tokensOf", async () => {
    const { eggs, alice, bob } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 3);
    await buyEggs(eggs, bob, 2);

    expect(await eggs.minted()).to.equal(5);
    expect(await eggs.totalSupply()).to.equal(5);
    expect(await eggs.ownerOf(1)).to.equal(alice.address);
    expect(await eggs.ownerOf(4)).to.equal(bob.address);
    expect((await eggs.tokensOf(alice.address)).map(Number)).to.deep.equal([1, 2, 3]);
    expect((await eggs.tokensOf(bob.address)).map(Number)).to.deep.equal([4, 5]);

    await eggs.connect(alice).transferFrom(alice.address, bob.address, 2);
    expect((await eggs.tokensOf(alice.address)).map(Number)).to.deep.equal([1, 3]);
    expect((await eggs.tokensOf(bob.address)).map(Number).sort()).to.deep.equal([2, 4, 5]);
  });

  it("enforces the per-wallet cap, counted by mints not by balance", async () => {
    const { eggs, alice, bob } = await loadFixture(deployFixture);
    await expect(eggs.connect(alice).mint(6, { value: PRICE * 6n }))
      .to.be.revertedWithCustomError(eggs, "WalletCapExceeded")
      .withArgs(6, 5);

    await buyEggs(eggs, alice, 5);
    await expect(eggs.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(
      eggs,
      "WalletCapExceeded",
    );

    // Sending eggs away does not reset the cap.
    await eggs.connect(alice).transferFrom(alice.address, bob.address, 1);
    await expect(eggs.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(
      eggs,
      "WalletCapExceeded",
    );

    await eggs.setMaxPerWallet(6);
    await buyEggs(eggs, alice, 1);
    expect(await eggs.mintedBy(alice.address)).to.equal(6);
  });

  it("caps the collection at MAX_SUPPLY across ownerMint and mint", async () => {
    const { eggs, deployer, alice } = await loadFixture(deployFixture);
    const max = Number(await eggs.MAX_SUPPLY());
    expect(max).to.equal(1111);

    // Owner mints everything but the last two eggs, in gas-sized chunks.
    let remaining = max - 2;
    while (remaining > 0) {
      const chunk = Math.min(100, remaining);
      await eggs.ownerMint(deployer.address, chunk);
      remaining -= chunk;
    }
    expect(await eggs.minted()).to.equal(max - 2);

    await expect(eggs.connect(alice).mint(3, { value: PRICE * 3n }))
      .to.be.revertedWithCustomError(eggs, "MaxSupplyExceeded")
      .withArgs(3, 2);
    await buyEggs(eggs, alice, 2);
    expect(await eggs.minted()).to.equal(max);
    expect(await eggs.ownerOf(max)).to.equal(alice.address);

    await expect(eggs.ownerMint(deployer.address, 1)).to.be.revertedWithCustomError(eggs, "MaxSupplyExceeded");
    await expect(eggs.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(
      eggs,
      "MaxSupplyExceeded",
    );
  });

  it("restricts ownerMint and setters to the owner", async () => {
    const { eggs, alice } = await loadFixture(deployFixture);
    await expect(eggs.connect(alice).ownerMint(alice.address, 1)).to.be.revertedWithCustomError(
      eggs,
      "OwnableUnauthorizedAccount",
    );
    await expect(eggs.connect(alice).setPrice(1)).to.be.revertedWithCustomError(eggs, "OwnableUnauthorizedAccount");
    await expect(eggs.connect(alice).setHatcher(alice.address)).to.be.revertedWithCustomError(
      eggs,
      "OwnableUnauthorizedAccount",
    );
    await expect(eggs.connect(alice).setSaleOpen(false)).to.be.revertedWithCustomError(
      eggs,
      "OwnableUnauthorizedAccount",
    );
  });

  it("only lets the hatcher hatch", async () => {
    const { eggs, alice, deployer } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await expect(eggs.connect(alice).hatch(1, 1)).to.be.revertedWithCustomError(eggs, "NotHatcher");
    await expect(eggs.connect(deployer).hatch(1, 1)).to.be.revertedWithCustomError(eggs, "NotHatcher");

    // Re-point the hatcher to an EOA to exercise the raw path.
    await eggs.setHatcher(deployer.address);
    await expect(eggs.connect(deployer).hatch(1, 1)).to.emit(eggs, "Hatched");
    await expect(eggs.connect(deployer).hatch(1, 1)).to.be.revertedWithCustomError(eggs, "AlreadyHatched").withArgs(1);
    await expect(eggs.connect(deployer).hatch(99, 1)).to.be.revertedWithCustomError(eggs, "ERC721NonexistentToken");
  });

  it("rolls a species in 1..6 and reports isHatched", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 5);
    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE * 5n);

    for (let id = 1; id <= 5; id++) {
      expect(await eggs.isHatched(id)).to.equal(false);
      expect(await eggs.speciesOf(id)).to.equal(0);
      await expect(hatchery.connect(alice).hatch(id)).to.emit(eggs, "Hatched");
      const species = Number(await eggs.speciesOf(id));
      expect(species).to.be.within(1, 6);
      expect(await eggs.isHatched(id)).to.equal(true);
    }
  });

  it("serves the egg URI before hatch and the token URI after", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice } = await loadFixture(deployFixture);
    await eggs.setBaseURI("ipfs://critters/");
    await buyEggs(eggs, alice, 2);

    expect(await eggs.tokenURI(1)).to.equal("ipfs://critters/egg");
    expect(await eggs.tokenURI(2)).to.equal("ipfs://critters/egg");

    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE);
    await hatchery.connect(alice).hatch(2);
    expect(await eggs.tokenURI(1)).to.equal("ipfs://critters/egg");
    expect(await eggs.tokenURI(2)).to.equal("ipfs://critters/2");

    await expect(eggs.tokenURI(3)).to.be.revertedWithCustomError(eggs, "ERC721NonexistentToken");

    await eggs.setContractURI("ipfs://critters/collection.json");
    expect(await eggs.contractURI()).to.equal("ipfs://critters/collection.json");
    expect(await eggs.baseURI()).to.equal("ipfs://critters/");
  });

  it("withdraws sale proceeds to the owner", async () => {
    const { eggs, eggsAddress, deployer, alice, bob } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 3);
    await buyEggs(eggs, bob, 1);
    const proceeds = PRICE * 4n;
    expect(await ethers.provider.getBalance(eggsAddress)).to.equal(proceeds);

    await expect(eggs.connect(alice).withdraw()).to.be.revertedWithCustomError(eggs, "OwnableUnauthorizedAccount");
    await expect(eggs.withdraw()).to.changeEtherBalances([eggsAddress, deployer.address], [-proceeds, proceeds]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("CrittrToken", () => {
  it("mints the full supply to the deployer and exempts the defaults", async () => {
    const { token, deployer, potAddress, hatcheryAddress, alice } = await loadFixture(deployFixture);
    expect(await token.totalSupply()).to.equal(units(1_000_000_000));
    expect(await token.name()).to.equal("Crittr");
    expect(await token.symbol()).to.equal("CRITTR");
    expect(await token.feeBps()).to.equal(300);
    expect(await token.pot()).to.equal(potAddress);
    expect(await token.feeExempt(deployer.address)).to.equal(true);
    expect(await token.feeExempt(potAddress)).to.equal(true);
    expect(await token.feeExempt(hatcheryAddress)).to.equal(true);
    expect(await token.feeExempt(alice.address)).to.equal(false);
  });

  it("takes the fee on a buy (pair -> wallet)", async () => {
    const { token, pair, carol, potAddress } = await loadFixture(deployFixture);
    const amount = units(10_000);
    const fee = (amount * 300n) / 10_000n;

    await expect(token.connect(pair).transfer(carol.address, amount))
      .to.emit(token, "FeeTaken")
      .withArgs(pair.address, carol.address, fee);

    expect(await token.balanceOf(carol.address)).to.equal(amount - fee);
    expect(await token.balanceOf(potAddress)).to.equal(fee);
  });

  it("takes the fee on a sell (wallet -> pair)", async () => {
    const { token, pair, alice, potAddress } = await loadFixture(deployFixture);
    const amount = units(1_000);
    const fee = (amount * 300n) / 10_000n;
    const pairBefore = await token.balanceOf(pair.address);

    await expect(token.connect(alice).transfer(pair.address, amount))
      .to.emit(token, "FeeTaken")
      .withArgs(alice.address, pair.address, fee);

    expect(await token.balanceOf(pair.address)).to.equal(pairBefore + amount - fee);
    expect(await token.balanceOf(potAddress)).to.equal(fee);
    expect(await token.balanceOf(alice.address)).to.equal(units(100_000) - amount);
  });

  it("charges nothing wallet-to-wallet", async () => {
    const { token, alice, bob, potAddress } = await loadFixture(deployFixture);
    await expect(token.connect(alice).transfer(bob.address, units(500))).to.not.emit(token, "FeeTaken");
    expect(await token.balanceOf(bob.address)).to.equal(units(100_500));
    expect(await token.balanceOf(potAddress)).to.equal(0);
  });

  it("charges nothing on exempt paths and pair-to-pair", async () => {
    const { token, deployer, pair, stranger, potAddress } = await loadFixture(deployFixture);
    // exempt deployer selling into the pair
    await expect(token.connect(deployer).transfer(pair.address, units(1_000))).to.not.emit(token, "FeeTaken");
    // pair buying to an exempt account
    await token.setFeeExempt(stranger.address, true);
    await expect(token.connect(pair).transfer(stranger.address, units(1_000))).to.not.emit(token, "FeeTaken");
    expect(await token.balanceOf(stranger.address)).to.equal(units(1_000));
    // pair-to-pair
    await token.setPair(stranger.address, true);
    await token.setFeeExempt(stranger.address, false);
    await expect(token.connect(pair).transfer(stranger.address, units(1_000))).to.not.emit(token, "FeeTaken");
    expect(await token.balanceOf(potAddress)).to.equal(0);
  });

  it("caps feeBps at 5% and honours 0", async () => {
    const { token, pair, carol, alice } = await loadFixture(deployFixture);
    await expect(token.setFeeBps(501)).to.be.revertedWithCustomError(token, "FeeTooHigh").withArgs(501, 500);
    await expect(token.connect(alice).setFeeBps(100)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount",
    );

    await token.setFeeBps(500);
    await expect(token.connect(pair).transfer(carol.address, units(1_000)))
      .to.emit(token, "FeeTaken")
      .withArgs(pair.address, carol.address, units(50));

    await token.setFeeBps(0);
    await expect(token.connect(pair).transfer(carol.address, units(1_000))).to.not.emit(token, "FeeTaken");
    expect(await token.balanceOf(carol.address)).to.equal(units(1_950));
  });

  it("charges nothing while no pot is set", async () => {
    const { token, pair, carol } = await loadFixture(deployFixture);
    await token.setPot(ethers.ZeroAddress);
    await expect(token.connect(pair).transfer(carol.address, units(1_000))).to.not.emit(token, "FeeTaken");
    expect(await token.balanceOf(carol.address)).to.equal(units(1_000));
  });

  it("burns and reduces totalSupply", async () => {
    const { token, alice } = await loadFixture(deployFixture);
    const before = await token.totalSupply();
    await token.connect(alice).burn(units(10));
    expect(await token.totalSupply()).to.equal(before - units(10));
    expect(await token.balanceOf(alice.address)).to.equal(units(99_990));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("RewardPot", () => {
  /** Funds the pot and builds a two-leaf tree for alice / bob. */
  async function potFixture() {
    const base = await deployFixture();
    const { token, potAddress, alice, bob } = base;
    await token.transfer(potAddress, units(1_000));

    const leaves: [string, bigint][] = [
      [alice.address, units(600)],
      [bob.address, units(300)],
    ];
    const tree = StandardMerkleTree.of(leaves, ["address", "uint256"]);
    const proofOf = (account: string) => {
      for (const [i, v] of tree.entries()) {
        if (v[0] === account) return tree.getProof(i);
      }
      throw new Error(`no leaf for ${account}`);
    };
    const closesAt = BigInt((await time.latest()) + WEEK);
    return { ...base, tree, proofOf, closesAt, total: units(900) };
  }

  it("bounds openWindow by the free balance and reserves it", async () => {
    const { pot, tree, closesAt } = await loadFixture(potFixture);
    expect(await pot.free()).to.equal(units(1_000));
    expect(await pot.reservedTotal()).to.equal(0);

    await expect(pot.openWindow(tree.root, units(1_001), closesAt))
      .to.be.revertedWithCustomError(pot, "InsufficientFree")
      .withArgs(units(1_001), units(1_000));

    await expect(pot.openWindow(tree.root, units(900), closesAt))
      .to.emit(pot, "WindowOpened")
      .withArgs(0, tree.root, units(900), closesAt);

    expect(await pot.windowCount()).to.equal(1);
    expect(await pot.reservedTotal()).to.equal(units(900));
    expect(await pot.free()).to.equal(units(100));
    const w = await pot.windows(0);
    expect(w.root).to.equal(tree.root);
    expect(w.total).to.equal(units(900));
    expect(w.claimed).to.equal(0);
    expect(w.closesAt).to.equal(closesAt);
    expect(w.closed).to.equal(false);
    expect(await pot.isOpen(0)).to.equal(true);

    // A second window can only use what is left.
    await expect(pot.openWindow(tree.root, units(101), closesAt)).to.be.revertedWithCustomError(
      pot,
      "InsufficientFree",
    );
    await pot.openWindow(tree.root, units(100), closesAt);
    expect(await pot.free()).to.equal(0);
  });

  it("validates openWindow inputs and ownership", async () => {
    const { pot, tree, closesAt, alice } = await loadFixture(potFixture);
    await expect(pot.connect(alice).openWindow(tree.root, 1, closesAt)).to.be.revertedWithCustomError(
      pot,
      "OwnableUnauthorizedAccount",
    );
    await expect(pot.openWindow(ethers.ZeroHash, 1, closesAt)).to.be.revertedWithCustomError(pot, "ZeroRoot");
    const past = BigInt(await time.latest());
    await expect(pot.openWindow(tree.root, 1, past)).to.be.revertedWithCustomError(pot, "ClosesInPast");
  });

  it("pays claims with a valid Merkle proof", async () => {
    const { pot, potAddress, token, tree, proofOf, closesAt, alice, bob } = await loadFixture(potFixture);
    await pot.openWindow(tree.root, units(900), closesAt);

    await expect(pot.connect(alice).claim(0, units(600), proofOf(alice.address)))
      .to.emit(pot, "Claimed")
      .withArgs(0, alice.address, units(600));
    expect(await token.balanceOf(alice.address)).to.equal(units(100_600));
    expect(await pot.isClaimed(0, alice.address)).to.equal(true);
    expect(await pot.isClaimed(0, bob.address)).to.equal(false);
    expect(await pot.reservedTotal()).to.equal(units(300));
    expect((await pot.windows(0)).claimed).to.equal(units(600));

    await pot.connect(bob).claim(0, units(300), proofOf(bob.address));
    expect(await token.balanceOf(bob.address)).to.equal(units(100_300));
    expect(await token.balanceOf(potAddress)).to.equal(units(100));
    expect(await pot.reservedTotal()).to.equal(0);
    expect(await pot.free()).to.equal(units(100));
  });

  it("rejects a double claim", async () => {
    const { pot, tree, proofOf, closesAt, alice } = await loadFixture(potFixture);
    await pot.openWindow(tree.root, units(900), closesAt);
    await pot.connect(alice).claim(0, units(600), proofOf(alice.address));
    await expect(pot.connect(alice).claim(0, units(600), proofOf(alice.address)))
      .to.be.revertedWithCustomError(pot, "AlreadyClaimed")
      .withArgs(0, alice.address);
  });

  it("rejects a wrong proof, wrong amount or wrong claimant", async () => {
    const { pot, tree, proofOf, closesAt, alice, bob, carol } = await loadFixture(potFixture);
    await pot.openWindow(tree.root, units(900), closesAt);

    // bob's proof used by alice
    await expect(pot.connect(alice).claim(0, units(600), proofOf(bob.address))).to.be.revertedWithCustomError(
      pot,
      "InvalidProof",
    );
    // right proof, inflated amount
    await expect(pot.connect(alice).claim(0, units(601), proofOf(alice.address))).to.be.revertedWithCustomError(
      pot,
      "InvalidProof",
    );
    // not in the tree at all
    await expect(pot.connect(carol).claim(0, units(1), proofOf(alice.address))).to.be.revertedWithCustomError(
      pot,
      "InvalidProof",
    );
    // empty proof
    await expect(pot.connect(alice).claim(0, units(600), [])).to.be.revertedWithCustomError(pot, "InvalidProof");
    // unknown window
    await expect(pot.connect(alice).claim(7, units(600), proofOf(alice.address))).to.be.revertedWithCustomError(
      pot,
      "UnknownWindow",
    );
  });

  it("rejects claims once closesAt has passed or the window is closed", async () => {
    const { pot, tree, proofOf, closesAt, alice, bob } = await loadFixture(potFixture);
    await pot.openWindow(tree.root, units(900), closesAt);

    // Owner closes early: bob can no longer claim.
    await pot.closeWindow(0);
    await expect(pot.connect(bob).claim(0, units(300), proofOf(bob.address))).to.be.revertedWithCustomError(
      pot,
      "WindowNotOpen",
    );

    // Fresh window, expire it by time.
    await pot.openWindow(tree.root, units(900), closesAt);
    await time.increaseTo(closesAt);
    expect(await pot.isOpen(1)).to.equal(false);
    await expect(pot.connect(alice).claim(1, units(600), proofOf(alice.address))).to.be.revertedWithCustomError(
      pot,
      "WindowNotOpen",
    );
  });

  it("closeWindow frees the unclaimed remainder for the next window", async () => {
    const { pot, tree, proofOf, closesAt, alice, stranger } = await loadFixture(potFixture);
    await pot.openWindow(tree.root, units(900), closesAt);
    await pot.connect(alice).claim(0, units(600), proofOf(alice.address));
    expect(await pot.free()).to.equal(units(100));

    // Not yet closable by a stranger.
    await expect(pot.connect(stranger).closeWindow(0))
      .to.be.revertedWithCustomError(pot, "NotYetClosable")
      .withArgs(0, closesAt);

    await time.increaseTo(closesAt);
    await expect(pot.connect(stranger).closeWindow(0)).to.emit(pot, "WindowClosed").withArgs(0, units(300));
    expect(await pot.reservedTotal()).to.equal(0);
    expect(await pot.free()).to.equal(units(400));
    expect((await pot.windows(0)).closed).to.equal(true);

    await expect(pot.closeWindow(0)).to.be.revertedWithCustomError(pot, "AlreadyClosed");
    await expect(pot.closeWindow(3)).to.be.revertedWithCustomError(pot, "UnknownWindow");

    // The freed 300 + the untouched 100 fund the next window.
    const next = BigInt((await time.latest()) + WEEK);
    await pot.openWindow(tree.root, units(400), next);
    expect(await pot.free()).to.equal(0);
  });

  it("counts trade fees as free balance", async () => {
    const { pot, token, pair, carol } = await loadFixture(potFixture);
    await token.connect(pair).transfer(carol.address, units(10_000)); // buy, 3% fee
    expect(await pot.free()).to.equal(units(1_000) + units(300));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Hatchery", () => {
  it("splits the fee: half burned, half to the pot", async () => {
    const { eggs, token, hatchery, hatcheryAddress, potAddress, alice } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE);

    const supplyBefore = await token.totalSupply();
    await expect(hatchery.connect(alice).hatch(1)).to.emit(hatchery, "EggHatched");

    expect(await token.totalSupply()).to.equal(supplyBefore - units(500));
    expect(await token.balanceOf(potAddress)).to.equal(units(500));
    expect(await token.balanceOf(hatcheryAddress)).to.equal(0);
    expect(await token.balanceOf(alice.address)).to.equal(units(99_000));
    expect(Number(await eggs.speciesOf(1))).to.be.within(1, 6);
  });

  it("emits EggHatched with the rolled species", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE);
    const tx = await hatchery.connect(alice).hatch(1);
    const receipt = await tx.wait();
    const log = receipt!.logs
      .map((l) => {
        try {
          return hatchery.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p?.name === "EggHatched");
    expect(log).to.not.equal(undefined);
    expect(log!.args.tokenId).to.equal(1);
    expect(log!.args.by).to.equal(alice.address);
    expect(log!.args.species).to.equal(await eggs.speciesOf(1));
  });

  it("refuses a hatch from someone who does not own the egg", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice, bob } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await token.connect(bob).approve(hatcheryAddress, HATCH_FEE);
    await expect(hatchery.connect(bob).hatch(1))
      .to.be.revertedWithCustomError(hatchery, "NotEggOwner")
      .withArgs(1, bob.address);
    await expect(hatchery.connect(bob).hatch(42)).to.be.revertedWithCustomError(eggs, "ERC721NonexistentToken");
  });

  it("refuses to hatch twice and refuses without allowance", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await expect(hatchery.connect(alice).hatch(1)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE * 2n);
    await hatchery.connect(alice).hatch(1);
    await expect(hatchery.connect(alice).hatch(1)).to.be.revertedWithCustomError(hatchery, "AlreadyHatched").withArgs(1);
  });

  it("hatches for free when hatchFee is 0", async () => {
    const { eggs, token, hatchery, potAddress, carol } = await loadFixture(deployFixture);
    await buyEggs(eggs, carol, 1); // carol holds no CRITTR at all
    expect(await token.balanceOf(carol.address)).to.equal(0);

    await hatchery.setHatchFee(0);
    const supplyBefore = await token.totalSupply();
    await expect(hatchery.connect(carol).hatch(1)).to.emit(eggs, "Hatched");
    expect(await eggs.isHatched(1)).to.equal(true);
    expect(await token.totalSupply()).to.equal(supplyBefore);
    expect(await token.balanceOf(potAddress)).to.equal(0);
  });

  it("honours burnBps at both ends and caps it", async () => {
    const { eggs, token, hatchery, hatcheryAddress, potAddress, alice } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 2);
    await token.connect(alice).approve(hatcheryAddress, HATCH_FEE * 2n);

    await expect(hatchery.setBurnBps(10_001)).to.be.revertedWithCustomError(hatchery, "BurnBpsTooHigh");
    await expect(hatchery.connect(alice).setBurnBps(0)).to.be.revertedWithCustomError(
      hatchery,
      "OwnableUnauthorizedAccount",
    );

    // Everything burned
    await hatchery.setBurnBps(10_000);
    let supply = await token.totalSupply();
    await hatchery.connect(alice).hatch(1);
    expect(await token.totalSupply()).to.equal(supply - HATCH_FEE);
    expect(await token.balanceOf(potAddress)).to.equal(0);

    // Nothing burned
    await hatchery.setBurnBps(0);
    supply = await token.totalSupply();
    await hatchery.connect(alice).hatch(2);
    expect(await token.totalSupply()).to.equal(supply);
    expect(await token.balanceOf(potAddress)).to.equal(HATCH_FEE);
  });

  it("lets the owner change the fee and the pot", async () => {
    const { eggs, token, hatchery, hatcheryAddress, alice, stranger } = await loadFixture(deployFixture);
    await buyEggs(eggs, alice, 1);
    await hatchery.setHatchFee(units(10));
    await hatchery.setPot(stranger.address);
    await expect(hatchery.setPot(ethers.ZeroAddress)).to.be.revertedWithCustomError(hatchery, "ZeroAddress");

    await token.connect(alice).approve(hatcheryAddress, units(10));
    await hatchery.connect(alice).hatch(1);
    expect(await token.balanceOf(stranger.address)).to.equal(units(5));
    expect(await token.balanceOf(alice.address)).to.equal(units(99_990));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("Payout", () => {
  /** Starting float, i.e. what the deployer seeds the Payout with. */
  const FLOAT = units(10_000);
  const HOUR = 60 * 60;

  /** The EIP-712 struct the game server signs. Must match Payout.CLAIM_TYPEHASH. */
  const CLAIM_TYPES = {
    Claim: [
      { name: "account", type: "address" },
      { name: "cumulative", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  /**
   * deployFixture + a Payout whose voucher signer is `gameSigner`, owned by the
   * deployer and seeded with FLOAT.
   *
   * deployFixture still points the token's trade fee at the RewardPot; the one
   * test that cares re-points it with token.setPot(payout), which is what
   * scripts/deploy.ts wires in production.
   */
  async function payoutFixture() {
    const base = await deployFixture();
    const { token, tokenAddress, deployer } = base;
    const signers = await ethers.getSigners();
    const gameSigner = signers[6];
    const rogueSigner = signers[7];

    const payout = await (
      await ethers.getContractFactory("Payout")
    ).deploy(tokenAddress, gameSigner.address, deployer.address);
    const payoutAddress = await payout.getAddress();

    await token.setFeeExempt(payoutAddress, true);
    await token.transfer(payoutAddress, FLOAT); // no deposit function: a plain transfer funds it

    const domain = {
      name: "CrittrPayout",
      version: "1",
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: payoutAddress,
    };

    /** Signs Claim(account, cumulative, deadline). Defaults: +1h, signed by the game key. */
    const voucher = async (
      account: string,
      cumulative: bigint,
      opts: { deadline?: bigint; by?: any } = {},
    ) => {
      const deadline = opts.deadline ?? BigInt((await time.latest()) + HOUR);
      const by = opts.by ?? gameSigner;
      const signature = await by.signTypedData(domain, CLAIM_TYPES, { account, cumulative, deadline });
      return { cumulative, deadline, signature };
    };

    return { ...base, payout, payoutAddress, gameSigner, rogueSigner, domain, voucher };
  }

  it("deploys with the token, the signer and the owner set", async () => {
    const { payout, tokenAddress, deployer, gameSigner } = await loadFixture(payoutFixture);
    expect(await payout.token()).to.equal(tokenAddress);
    expect(await payout.signer()).to.equal(gameSigner.address);
    expect(await payout.owner()).to.equal(deployer.address);
    expect(await payout.paused()).to.equal(false);
    expect(await payout.totalClaimed()).to.equal(0);
    expect(await payout.available()).to.equal(FLOAT);

    const factory = await ethers.getContractFactory("Payout");
    await expect(
      factory.deploy(ethers.ZeroAddress, gameSigner.address, deployer.address),
    ).to.be.revertedWith("Payout: token is zero");
    await expect(factory.deploy(tokenAddress, ethers.ZeroAddress, deployer.address)).to.be.revertedWith(
      "Payout: signer is zero",
    );
  });

  it("hashes a voucher exactly like the EIP-712 domain the server signs over", async () => {
    const { payout, domain, alice } = await loadFixture(payoutFixture);
    const deadline = BigInt((await time.latest()) + HOUR);
    const value = { account: alice.address, cumulative: units(500), deadline };

    expect(await payout.CLAIM_TYPEHASH()).to.equal(
      ethers.id("Claim(address account,uint256 cumulative,uint256 deadline)"),
    );
    expect(await payout.hashClaim(alice.address, units(500), deadline)).to.equal(
      ethers.TypedDataEncoder.hash(domain, CLAIM_TYPES, value),
    );
  });

  it("pays a valid voucher and records the cumulative", async () => {
    const { payout, payoutAddress, token, alice, voucher } = await loadFixture(payoutFixture);
    const v = await voucher(alice.address, units(500));

    await expect(payout.connect(alice).claim(v.cumulative, v.deadline, v.signature))
      .to.emit(payout, "Claimed")
      .withArgs(alice.address, units(500), units(500));

    expect(await token.balanceOf(alice.address)).to.equal(units(100_500));
    expect(await token.balanceOf(payoutAddress)).to.equal(FLOAT - units(500));
    expect(await payout.claimed(alice.address)).to.equal(units(500));
    expect(await payout.totalClaimed()).to.equal(units(500));
    expect(await payout.available()).to.equal(units(9_500));
  });

  it("pays only the difference on the next voucher", async () => {
    const { payout, token, alice, voucher } = await loadFixture(payoutFixture);
    const first = await voucher(alice.address, units(500));
    await payout.connect(alice).claim(first.cumulative, first.deadline, first.signature);

    const second = await voucher(alice.address, units(1_250));
    expect(
      await payout.connect(alice).claim.staticCall(second.cumulative, second.deadline, second.signature),
    ).to.equal(units(750));

    await expect(payout.connect(alice).claim(second.cumulative, second.deadline, second.signature))
      .to.emit(payout, "Claimed")
      .withArgs(alice.address, units(750), units(1_250));

    expect(await payout.claimed(alice.address)).to.equal(units(1_250));
    expect(await payout.totalClaimed()).to.equal(units(1_250));
    expect(await token.balanceOf(alice.address)).to.equal(units(101_250));
  });

  it("refuses a replayed voucher", async () => {
    const { payout, token, alice, voucher } = await loadFixture(payoutFixture);
    const v = await voucher(alice.address, units(500));
    await payout.connect(alice).claim(v.cumulative, v.deadline, v.signature);

    await expect(payout.connect(alice).claim(v.cumulative, v.deadline, v.signature)).to.be.revertedWith(
      "Payout: nothing to claim",
    );
    expect(await token.balanceOf(alice.address)).to.equal(units(100_500));
    expect(await payout.totalClaimed()).to.equal(units(500));
  });

  it("refuses a voucher whose cumulative went backwards", async () => {
    const { payout, alice, voucher } = await loadFixture(payoutFixture);
    const first = await voucher(alice.address, units(900));
    await payout.connect(alice).claim(first.cumulative, first.deadline, first.signature);

    const stale = await voucher(alice.address, units(400));
    await expect(payout.connect(alice).claim(stale.cumulative, stale.deadline, stale.signature)).to.be.revertedWith(
      "Payout: nothing to claim",
    );
    expect(await payout.claimed(alice.address)).to.equal(units(900));
  });

  it("refuses a voucher signed by the wrong key", async () => {
    const { payout, alice, rogueSigner, voucher } = await loadFixture(payoutFixture);
    const forged = await voucher(alice.address, units(500), { by: rogueSigner });

    await expect(payout.connect(alice).claim(forged.cumulative, forged.deadline, forged.signature)).to.be.revertedWith(
      "Payout: bad signature",
    );
    expect(await payout.claimed(alice.address)).to.equal(0);
  });

  it("refuses a voucher issued to somebody else", async () => {
    const { payout, token, alice, bob, voucher } = await loadFixture(payoutFixture);
    const forAlice = await voucher(alice.address, units(500));

    await expect(
      payout.connect(bob).claim(forAlice.cumulative, forAlice.deadline, forAlice.signature),
    ).to.be.revertedWith("Payout: bad signature");
    expect(await payout.claimed(bob.address)).to.equal(0);

    // The same bytes still pay the account they name.
    await payout.connect(alice).claim(forAlice.cumulative, forAlice.deadline, forAlice.signature);
    expect(await token.balanceOf(alice.address)).to.equal(units(100_500));
  });

  it("refuses an expired voucher", async () => {
    const { payout, alice, voucher } = await loadFixture(payoutFixture);
    const expired = await voucher(alice.address, units(500), { deadline: BigInt((await time.latest()) - 60) });

    await expect(
      payout.connect(alice).claim(expired.cumulative, expired.deadline, expired.signature),
    ).to.be.revertedWith("Payout: voucher expired");

    const live = await voucher(alice.address, units(500));
    await payout.connect(alice).claim(live.cumulative, live.deadline, live.signature);
    expect(await payout.claimed(alice.address)).to.equal(units(500));
  });

  it("stops and restarts claims with setPaused", async () => {
    const { payout, alice, stranger, voucher } = await loadFixture(payoutFixture);
    await expect(payout.setPaused(true)).to.emit(payout, "PausedSet").withArgs(true);
    expect(await payout.paused()).to.equal(true);

    const v = await voucher(alice.address, units(500));
    await expect(payout.connect(alice).claim(v.cumulative, v.deadline, v.signature)).to.be.revertedWith(
      "Payout: paused",
    );

    await expect(payout.connect(stranger).setPaused(false)).to.be.revertedWithCustomError(
      payout,
      "OwnableUnauthorizedAccount",
    );

    await expect(payout.setPaused(false)).to.emit(payout, "PausedSet").withArgs(false);
    await expect(payout.connect(alice).claim(v.cumulative, v.deadline, v.signature))
      .to.emit(payout, "Claimed")
      .withArgs(alice.address, units(500), units(500));
  });

  it("refuses to pay more than it holds", async () => {
    const { payout, payoutAddress, token, alice, voucher } = await loadFixture(payoutFixture);
    const tooMuch = await voucher(alice.address, FLOAT + units(1));

    await expect(
      payout.connect(alice).claim(tooMuch.cumulative, tooMuch.deadline, tooMuch.signature),
    ).to.be.revertedWith("Payout: pot is empty");
    expect(await payout.claimed(alice.address)).to.equal(0);

    // One more token in the pot and the very same voucher goes through.
    await token.transfer(payoutAddress, units(1));
    await expect(payout.connect(alice).claim(tooMuch.cumulative, tooMuch.deadline, tooMuch.signature)).to.emit(
      payout,
      "Claimed",
    );
    expect(await payout.available()).to.equal(0);
  });

  it("rotates the signer: old vouchers die, new ones work", async () => {
    const { payout, alice, gameSigner, rogueSigner, voucher } = await loadFixture(payoutFixture);
    const old = await voucher(alice.address, units(500));

    await expect(payout.connect(alice).setSigner(rogueSigner.address)).to.be.revertedWithCustomError(
      payout,
      "OwnableUnauthorizedAccount",
    );
    await expect(payout.setSigner(ethers.ZeroAddress)).to.be.revertedWith("Payout: signer is zero");

    await expect(payout.setSigner(rogueSigner.address))
      .to.emit(payout, "SignerChanged")
      .withArgs(gameSigner.address, rogueSigner.address);
    expect(await payout.signer()).to.equal(rogueSigner.address);

    await expect(payout.connect(alice).claim(old.cumulative, old.deadline, old.signature)).to.be.revertedWith(
      "Payout: bad signature",
    );

    const fresh = await voucher(alice.address, units(500), { by: rogueSigner });
    await expect(payout.connect(alice).claim(fresh.cumulative, fresh.deadline, fresh.signature))
      .to.emit(payout, "Claimed")
      .withArgs(alice.address, units(500), units(500));
  });

  it("reports claimableFor without reverting on a stale cumulative", async () => {
    const { payout, alice, bob, voucher } = await loadFixture(payoutFixture);
    expect(await payout.claimableFor(alice.address, units(500))).to.equal(units(500));
    expect(await payout.claimableFor(alice.address, 0)).to.equal(0);

    const v = await voucher(alice.address, units(500));
    await payout.connect(alice).claim(v.cumulative, v.deadline, v.signature);

    expect(await payout.claimableFor(alice.address, units(500))).to.equal(0); // already paid
    expect(await payout.claimableFor(alice.address, units(499))).to.equal(0); // older still
    expect(await payout.claimableFor(alice.address, units(1_250))).to.equal(units(750));
    expect(await payout.claimableFor(bob.address, units(500))).to.equal(units(500));
  });

  it("collects the trade fee once token.setPot points at it", async () => {
    const { payout, payoutAddress, token, pair, carol } = await loadFixture(payoutFixture);
    await token.setPot(payoutAddress); // exactly what scripts/deploy.ts wires
    const before = await payout.available();

    // `pair` is the EOA deployFixture registered with token.setPair(pair, true).
    const amount = units(10_000);
    const fee = (amount * 300n) / 10_000n;
    await expect(token.connect(pair).transfer(carol.address, amount))
      .to.emit(token, "FeeTaken")
      .withArgs(pair.address, carol.address, fee);

    expect(await payout.available()).to.equal(before + fee);
    expect(await token.balanceOf(carol.address)).to.equal(amount - fee);
  });

  it("lets only the owner rescue the balance", async () => {
    const { payout, token, alice, stranger } = await loadFixture(payoutFixture);
    await expect(payout.connect(alice).rescue(alice.address, units(1))).to.be.revertedWithCustomError(
      payout,
      "OwnableUnauthorizedAccount",
    );
    await expect(payout.rescue(ethers.ZeroAddress, units(1))).to.be.revertedWith("Payout: to is zero");

    await expect(payout.rescue(stranger.address, units(4_000)))
      .to.emit(payout, "Rescued")
      .withArgs(stranger.address, units(4_000));

    expect(await token.balanceOf(stranger.address)).to.equal(units(4_000));
    expect(await payout.available()).to.equal(FLOAT - units(4_000));
    expect(await payout.totalClaimed()).to.equal(0); // a rescue is not a payout
  });
});
