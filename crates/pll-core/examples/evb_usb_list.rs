//! Read-only USB inventory; never claims an interface or writes to the board.
//! cargo run -p pll-core --example evb_usb_list
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let devices = pll_core::transport::evb::list_devices()?;
    println!("{}", serde_json::to_string_pretty(&devices)?);
    Ok(())
}
