const { ethers } = require("hardhat");

async function main() {
  const address = "0x4F01CB28EfC79bb0fF722b4d2B9cA62E313DC5fd";
  const balance = await ethers.provider.getBalance(address);
  console.log(`Address: ${address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} MNT`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
