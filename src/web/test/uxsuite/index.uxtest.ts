import { cleanupTempdir, pause, setupTempdir } from './utils';
import searchMotions from './searchMotions';
import captureKeys from './captureKeys.test';
import replay from './replay.test';

describe('UI Test Suite', () => {
    before(async function(){
        await pause(1000); // wait for VSCode to load

        setupTempdir();
    });

    searchMotions.run();
    // captureKeys.run();
    // replay.run();

    after(() => { cleanupTempdir(); });
});
