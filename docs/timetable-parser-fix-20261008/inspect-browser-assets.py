from pathlib import Path
roots=[Path.cwd(),Path('/Users/iaiangela/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules')]
for root in roots:
    print('Inspect local assets:',root)
    for name in ['react.production.min.js','react-dom.production.min.js','babel.min.js','html2canvas.min.js','lucide.min.js']:
        print(name, [str(p) for p in root.rglob(name)] if root.exists() else 'root absent')
    for package in ['react','react-dom','@babel/standalone','tailwindcss','html2canvas','lucide','playwright']:
        print(package, (root/package/'package.json').exists())
print('No assets fetched. Product browser test NOT RUN: pinned runtime assets unavailable. No browser/server started.')
