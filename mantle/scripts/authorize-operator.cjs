const { ethers } = require("hardhat");

async function main() {
  const registryAddress = "0x81226e8894D334c790D9a972855592E6C4eeB15C";
  const operatorAddress = "0x145e91520c3128828C8031339a7b7CC49f1BDEF6";

  const [deployer] = await ethers.getSigners();
  console.log("Authorizing from:", deployer.address);

  const registry = await ethers.getContractAt("MantleConvictionRegistry", registryAddress);

  console.log(`Authorizing operator ${operatorAddress}...`);
  const tx = await registry.setOperatorAuthorization(operatorAddress, true);
  console.log("Transaction submitted:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);
  console.log("Operator authorized ✓");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
