
## Tests

### 2024-06-25

I've been through a few iterations of tests. I tried vscode-extension-tester and that
proved to be somewhat unreliable and poorly maintained/engineered.

I'm now trying out wdio-service-vscode: it is far from perfect, but it seems to be built
on a much more solid foundation and there are several substantial packages in the vscode
that use it.

However I seem to be hitting edge cases:
    - I can't get my tests to run without using a browser rather than vscode
      as the browser type: https://github.com/webdriverio-community/wdio-vscode-service/issues/123
    - headless mode is poorly supported (standard functions in the repo don't work): https://github.com/webdriverio-community/wdio-vscode-service/issues/125

For now this means that I probably won't be able to run this in CI (I can try but need to assume the worst).
