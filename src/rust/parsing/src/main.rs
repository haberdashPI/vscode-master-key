use std::env;
use std::fs;

use parsing::file::parse_keybinding_data;

// NOTE: this isn't a user facing executable, so we are lazy about error handling
fn process_preset(path: &str) -> String {
    let data = std::fs::read(path).expect("file to exist");
    let result = parse_keybinding_data(&data);
    return result.text_docs().expect("documentation");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: parsing <input> <output>");
        return;
    }

    let output = process_preset(&args[1]);
    fs::write(&args[2], output).expect("file write to work");
}
