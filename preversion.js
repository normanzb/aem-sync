const readPkg = require('read-pkg');
const fs = require('fs');
const FILENAME = 'README.md';
readPkg().then(pkg => {
    var readmeContent = fs.readFileSync(FILENAME, 'utf8');
    readmeContent = readmeContent.replace(new RegExp(pkg.version, 'g'), '<placeholder>');
    fs.writeFileSync(FILENAME, readmeContent, 'utf8');
});