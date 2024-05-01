import { cleanupTempdir, pause, setupTempdir } from './utils';
import simpleMotions from './simpleMotions';
import commandState from "./commandState";
import searchMotions from './searchMotions';
import captureKeys from './captureKeys.test';
import replay from './replay.test';
import commandPalette from './commandPalette';

describe('UI Test Suite', () => {
    before(async function(){
        await pause(1000); // wait for VSCode to load

        setupTempdir();
    });

    simpleMotions.run();
    commandPalette.run();
    commandState.run();
    searchMotions.run();
    captureKeys.run();
    replay.run();

    after(() => { cleanupTempdir(); });
});
