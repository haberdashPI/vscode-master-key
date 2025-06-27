// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as assert from 'assert';
import { assertCursorMovesBy, cursorToStart, editorWithText } from './utils';

suite('Do command', () => {
    let editor: vscode.TextEditor;
    suiteSetup(async () => {
        // eslint-disable-next-line @stylistic/max-len
        editor = await editorWithText(`Anim reprehenderit voluptate magna excepteur dolore aliqua minim labore est
consectetur ullamco ullamco aliqua ex. Pariatur officia nostrud pariatur ex
dolor magna. Consequat cupidatat amet nostrud proident occaecat ex.
Ex cillum duis anim dolor cupidatat non nostrud non et sint ullamco.
Consectetur consequat ipsum ex labore enim. Amet do commodo et occaecat
proident ex cupidatat in. Quis id magna laborum ad. Dolore exercitation
cillum eiusmod culpa minim duis`);
    });

    test('Can run', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, new vscode.Position(0, 1), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'count',
                        },
                    }],
            });
        });
    });

    test('Can run with repeat', async () => {
        cursorToStart(editor);

        await assertCursorMovesBy(editor, new vscode.Position(0, 2), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'count',
                        },
                    }],
                computedRepeat: 1,
            });
        });
    });

    test('Can run with computed repeat', async () => {
        cursorToStart(editor);

        await assertCursorMovesBy(editor, new vscode.Position(0, 4), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'count',
                        },
                    }],
                computedRepeat: '1+2',
            });
        });
    });

    test('Fails on invalid computed repeat', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, new vscode.Position(0, 0), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'count',
                        },
                    }],
                computedRepeat: '"a"+ "b"',
            });
        });
    });

    test('Can use `count` field', async () => {
        cursorToStart(editor);
        for (let c = 1; c <= 3; c++) {
            await assertCursorMovesBy(editor, new vscode.Position(0, c), async () => {
                await vscode.commands.executeCommand('master-key.updateCount', {
                    value: c,
                });

                await vscode.commands.executeCommand('master-key.do', {
                    do: [
                        {
                            command: 'cursorMove',
                            args: {
                                to: 'right',
                            },
                            computedArgs: {
                                value: 'count',
                            },
                        },
                    ],
                });
            });
        }
    });

    test('Can use flags', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, new vscode.Position(0, 2), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.prefix',
                        args: {
                            flag: 'my_flag_on',
                            code: 1,
                        },
                    },
                ],
                finalKey: false,
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'my_flag_on ? 2 : 1',
                        },
                    },
                ],
            });
        });
    });

    test('Properly resets state after an error', async () => {
        cursorToStart(editor);
        const shouldFail = async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.prefix',
                        args: {
                            flag: 'my_flag_on',
                            code: 1,
                        },
                    },
                ],
                finalKey: false,
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMoveBob',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'my_flag_on ? 2 : 1',
                        },
                    },
                ],
            });
        };
        try {
            const _ = await shouldFail();
            assert.fail('Expected command to error');
        } catch (e) {
            console.log('Found expected error: ' + e);
        }

        await assertCursorMovesBy(editor, new vscode.Position(0, 2), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.prefix',
                        args: {
                            flag: 'my_flag_on',
                            code: 1,
                        },
                    },
                ],
                finalKey: false,
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'my_flag_on ? 2 : 1',
                        },
                    },
                ],
            });
        });
    });

    test('Can read mode to change state', async () => {
        cursorToStart(editor);
        await assertCursorMovesBy(editor, new vscode.Position(0, 2), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.setMode',
                        args: {
                            value: 'normal',
                        },
                    },
                ],
                finalKey: false,
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'cursorMove',
                        args: {
                            to: 'right',
                        },
                        computedArgs: {
                            value: 'mode == "normal" ? 2 : 1',
                        },
                    },
                ],
            });
        });
    });

    test('Can run stored commands', async () => {
        // 8 characters is the size of the first word in `text.md`
        cursorToStart(editor);
        assertCursorMovesBy(editor, new vscode.Position(0, 8), async () => {
            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.prefix',
                        args: { code: 2 },
                    },
                    {
                        command: 'master-key.storeCommand',
                        args: {
                            command: 'cursorWordLeft',
                            register: 'operation',
                        },
                    },
                ],
                finalKey: false,
            });

            await vscode.commands.executeCommand('master-key.do', {
                do: [
                    {
                        command: 'master-key.executeStoredCommand',
                        args: { register: 'operation' },
                    },
                ],
            });
        });
    });
});
