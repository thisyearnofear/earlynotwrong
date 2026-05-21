import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);

  const MantleConvictionRegistry = await ethers.getContractFactory("MantleConvictionRegistry");
  const registry = await MantleConvictionRegistry.deploy();

  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("MantleConvictionRegistry deployed to:", address);

  console.log("\nVerification command:");
  console.log(`npx hardhat verify --network mantle-sepolia ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
