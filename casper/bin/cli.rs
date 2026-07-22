//! CLI tool for the ConvictionRegistry smart contract.
//!
//! Supports deploying the contract and running read/query scenarios
//! via the odra-cli framework.

use casper::conviction_registry::ConvictionRegistry;
use odra::host::{HostEnv, NoArgs};
use odra::schema::casper_contract_schema::NamedCLType;
use odra_cli::{
    deploy::DeployScript,
    scenario::{Args, Error, Scenario, ScenarioMetadata},
    CommandArg, ContractProvider, DeployedContractsContainer, DeployerExt,
    OdraCli,
};

/// Deploys the `ConvictionRegistry` contract.
pub struct ConvictionRegistryDeployScript;

impl DeployScript for ConvictionRegistryDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let _registry = ConvictionRegistry::load_or_deploy(
            &env,
            NoArgs,
            container,
            350_000_000_000, // Adjust gas limit as needed
        )?;

        Ok(())
    }
}

/// Scenario that queries the latest conviction record for a subject.
pub struct GetLatestConvictionScenario;

impl Scenario for GetLatestConvictionScenario {
    fn args(&self) -> Vec<CommandArg> {
        vec![CommandArg::new(
            "subject_hash",
            "The 32-byte subject hash to query (hex-encoded)",
            NamedCLType::ByteArray(32),
        )]
    }

    fn run(
        &self,
        env: &HostEnv,
        container: &DeployedContractsContainer,
        args: Args,
    ) -> Result<(), Error> {
        let contract = container.contract_ref::<ConvictionRegistry>(env)?;
        let subject_hash = args.get_single::<[u8; 32]>("subject_hash")?;

        env.set_gas(50_000_000);
        let record = contract.get_latest_conviction(subject_hash.into());
        println!("Latest conviction: {:?}", record);

        Ok(())
    }
}

impl ScenarioMetadata for GetLatestConvictionScenario {
    const NAME: &'static str = "get-latest";
    const DESCRIPTION: &'static str =
        "Queries the latest conviction record for a given subject hash";
}

/// Main function to run the CLI tool.
pub fn main() {
    OdraCli::new()
        .about("CLI tool for the ConvictionRegistry smart contract")
        .deploy(ConvictionRegistryDeployScript)
        .contract::<ConvictionRegistry>()
        .scenario(GetLatestConvictionScenario)
        .build()
        .run();
}
