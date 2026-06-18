// Hide the Windows console window for the GUI app — always, including our
// fast --debug builds (the release-only guard left a console in debug).
#![windows_subsystem = "windows"]

fn main() {
    theterm_lib::run()
}
