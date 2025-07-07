// constraints are validate the global semantics of keybindings the can only occur once a
// keybinding file has already been fully parsed

use crate::command::CommandInput;
use crate::error::{Error, Result, constrain};
use crate::util::Requiring;

// TODO: change this and test it *after* writing the other bits of the pipeline
pub fn prefix_is_not_final_key(val: &CommandInput) -> Result<()> {
    if val.finalKey.unwrap_or(true) {
        let command = val.command.clone().require("command")?;
        if command == "master-key.prefix" {
            return constrain("`finalKey == false` when calling command `mater-key.prefix`");
        } else if command == "runCommands" {
            let commands = val
                .args
                .as_ref()
                .map(|x| x.get("commands"))
                .flatten()
                .map(|x| x.as_array())
                .unwrap_or_default();

            for command in commands.into_iter().flatten() {
                let command_name = command
                    .get("command")
                    // while there are other valid forms for `args.commands` to take they
                    // can all be normalized (before this function call) to take on this
                    // format
                    .expect("`runCommands` `args.commands` elements to have `command` field")
                    .as_str()
                    .unwrap_or_default();

                if command_name == "master-key.prefix" {
                    return constrain(
                        "`finalKey == false` when calling command `mater-key.prefix`",
                    );
                }
            }
        }
    }
    return Ok(());
}
