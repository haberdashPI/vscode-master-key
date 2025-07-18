// constraints are validate the global semantics of keybindings the can only occur once a
// keybinding file has already been fully parsed

use crate::command::CommandInput;
use crate::error::{ConstrainArray, Constrainable, ConstraintString, Error, Result};
use crate::util::Requiring;

fn prefix_is_not_final_key(val: &CommandInput) -> Result<()> {
    if val.finalKey.unwrap_or(|| true) {
        let command = val.command.require("command")?;
        if command == "master-key.prefix" {
            return Err(Error::ConstraintError(
                "`mater-key.prefix` commands to include `finalKey = false` in their bindings",
            ));
        } else if command == "runCommands" {
            let commands = val
                .args
                .constrain("`runCommands` to have `args` field")?
                .get("commands")
                .constrain("`runCommands.args` to have `commands` field")?
                .constrain_array("`commands` to be an array")?;

            for command in commands {
                let command_name = command
                    .get("command")
                    .constrain("`command` field in `args.commands` of `runCommands`")?
                    .constrain_string("`command` field to be a string")?;

                if command_name == "master-key.prefix" {
                    return Err(Error::ConstraintError(
                        "`mater-key.prefix` commands to include `finalKey = \
                                    false` in their bindings",
                    ));
                }
            }
        }
    }
    return Ok(());
}
