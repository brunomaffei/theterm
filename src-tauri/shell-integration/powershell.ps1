# THETERM shell integration for Windows PowerShell 5.1+ / PowerShell 7+.
# Emits OSC 133 / OSC 633 markers so the terminal can split output into blocks.
# Designed to degrade gracefully: it never throws if PSReadLine is unavailable.
#
#   OSC 133 ; A           -> prompt start
#   OSC 133 ; B           -> command input start (end of prompt)
#   OSC 133 ; C           -> command output start (just before execution)
#   OSC 133 ; D ; <exit>  -> command finished with integer exit code
#   OSC 633 ; E ; <cmd>   -> command line text, URL-encoded
#
# ST (string terminator) is BEL (0x07); the introducer is ESC ] (0x1b 0x5d).

$global:__THETERM_ESC = [char]27
$global:__THETERM_BEL = [char]7

# Capture the user's original prompt function so we can render it unchanged
# between our markers.
if (-not (Test-Path variable:global:__THETERM_ORIGINAL_PROMPT)) {
    $global:__THETERM_ORIGINAL_PROMPT = $function:prompt
}

function global:prompt {
    $esc = $global:__THETERM_ESC
    $bel = $global:__THETERM_BEL

    # Capture the exit status of the command that just finished.
    $lastExit = 0
    if ($null -ne $LASTEXITCODE) { $lastExit = $LASTEXITCODE }

    # D = command finished (for the previous command).
    $out = "$esc]133;D;$lastExit$bel"
    # A = prompt start.
    $out += "$esc]133;A$bel"

    # Render the original prompt text.
    $original = ''
    try {
        if ($null -ne $global:__THETERM_ORIGINAL_PROMPT) {
            $original = & $global:__THETERM_ORIGINAL_PROMPT
        }
    } catch {
        $original = ''
    }
    if ([string]::IsNullOrEmpty($original)) {
        $original = "PS $($executionContext.SessionState.Path.CurrentLocation)> "
    }
    $out += $original

    # B = command input start (end of prompt).
    $out += "$esc]133;B$bel"

    # Preserve $LASTEXITCODE for the user's own scripts.
    $global:LASTEXITCODE = $lastExit
    return $out
}

# When PSReadLine is present, hook Enter so we can emit the command line (633;E)
# and the output-start marker (133;C) right before the command runs.
try {
    if (Get-Module -ListAvailable -Name PSReadLine) {
        Import-Module PSReadLine -ErrorAction Stop

        Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
            $esc = $global:__THETERM_ESC
            $bel = $global:__THETERM_BEL

            $line = ''
            $cursor = 0
            try {
                [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
            } catch {
                $line = ''
            }

            try {
                if (-not [string]::IsNullOrEmpty($line)) {
                    $encoded = [uri]::EscapeDataString($line)
                    [Console]::Write("$esc]633;E;$encoded$bel")
                }
                # C = command output start.
                [Console]::Write("$esc]133;C$bel")
            } catch {
                # Never block the Enter key on a marker failure.
            }

            [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        }
    }
} catch {
    # PSReadLine not available or failed to configure: prompt-based 133;A/B/D
    # markers still work; we simply skip 633;E and 133;C.
}
