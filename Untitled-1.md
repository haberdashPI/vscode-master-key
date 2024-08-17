
            # # Test Documentation

            #- IGNORED COMMENT
            [header]
            version = "1.0"

            [[mode]]
            name = "insert"
            default = true

            [[mode]]
            name = "normal"

            [[kind]]
            name = "left"
            description = "more leftward keys"

            [[kind]]
            name = "right"
            description = "more rightward keys"

            # ## First Section

            # Cillum adipisicing consequat aliquip Lorem adipisicing minim culpa officia aliquip reprehenderit.

            [[bind]]
            name = "normal mode"
            key = "escape"
            command = "master-key.enterNormal"
            prefixes = "<all-prefixes>"
            hideInPalette = true

            [[path]]
            id = "motion"
            name = "basic motions"
            default.command = "cursorMove"
            default.mode = "normal"
            default.when = "editorTextFocus"
            default.computedArgs.value = "count"

            [[bind]]
            path = "motion"
            name = "left"
            key = "h"
            args.to = "left"
            kind = "left"

            [[bind]]
            path = "motion"
            name = "right"
            key = "l"
            args.to = "right"
            kind = "right"

            [[bind]]
            path = "motion"
            name = "down"
            key = "j"
            args.to = "down"
            kind = "left"

            # ## Second Section

            # Aliquip ipsum enim cupidatat aute occaecat magna nostrud qui labore.

            [[bind]]
            path = "motion"
            name = "up"
            key = "k"
            args.to = "up"
            kind = "right"

            [[bind]]
            path = "motion"
            name = "funny right"
            key = "w w"
            mode = "normal"
            args.to = "right"
            kind = "right"

            [[bind]]
            name = "insert mode"
            key = "i"
            command = "master-key.enterInsert"
            mode = "normal"
            kind = "right"

            # Final paragraph shows up.
        
[[bind]]
name = "show coverage"
key = "ctrl+shift+alt+c"
mode = []
prefixes = "<all-prefixes>"
command = "master-key.writeCoverageToEditor"
hideInPalette = true
hideInDocs = true
