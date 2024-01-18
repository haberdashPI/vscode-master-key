import { cleanupTempdir, pause, setupTempdir } from './utils';
import simpleMotions from './simpleMotions';
import commandState from "./commandState";

describe('UI Test Suite', () => {
    before(async function(){
        await pause(1000); // wait for VSCode to load

        setupTempdir();
    });

    simpleMotions.run();
    commandState.run();

    after(() => { cleanupTempdir(); });
});
