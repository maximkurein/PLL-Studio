//! PLL Studio core: everything about the IDT/Renesas 8V97051 wideband
//! RF synthesizer that does not depend on a UI.

pub mod api;
pub mod loopfilter;
pub mod noise;
pub mod plan;
pub mod power;
pub mod regs;
pub mod sim;
pub mod transport;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Link(String),
    #[error("{0}")]
    Invalid(String),
    #[error("неизвестная команда: {0}")]
    UnknownCommand(String),
    #[error("аргументы команды: {0}")]
    Args(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

pub use api::Engine;
