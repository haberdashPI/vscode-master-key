import assert from 'assert';
import { VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';


describe('My Test Suite', () => {
    let browser: VSBrowser;
    let driver: WebDriver;
    let workbench: Workbench;

    // initialize the browser and webdriver
    before(async () => {
        browser = VSBrowser.instance;
        driver = browser.driver;
        workbench = new Workbench();

        // THOUGHTS HERE: 
        // we need a simple way to configure keybindings in 
        // each group of units tests; 
        // OPTIONS: 
        // 1. find a way to call extension API from the driver; not obvious to me how to do this
        // 2. make a new command that draws from a file; we can preface tests by
        // writing to a file and then use that to configure keybindings
        workbench.executeCommand('Master Key: Select Binding');

    });

    // test whatever we want using webdriver, here we are just checking the page title
    it('Left Motion', async () => {
        const title = await driver.getTitle();
        assert.equal(title, 'whatever');
    });
});
