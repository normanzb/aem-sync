#!/usr/bin/env node

var fs = require('fs');
var parseArgs = require('minimist');
var path = require('path').posix;
var compromise = require('compromise');
var xml2js = require('xml2js');
var AEM = require('aem-api');

const DIR_BASE = path.join('jcr_root');
const FILE_DOT_CONTENT_XML = '.content.xml';

var lexcicon = {rename: 'Verb', change: 'Verb'};

var args = parseArgs(process.argv.slice(2), {
    alias: {
        'base': 'b',
        'host': 'h',
        'protocol': 't',
        'port': 'p',
        'username': 'u',
        'password': 'w',
    },
    default: {
        'base': DIR_BASE,
        'host': 'localhost',
        'protocol': 'http',
        'port': 4502,
        'username': 'admin',
        'password': 'admin',
    }
});

var command = args._[0];

function isGitFile(filePath) {
    return isFileOf(filePath, function(dir){
        return dir.indexOf('.git') === 0;
    });
}

function isInsideNodeModuleFolder(filePath) {
    return isFileOf(filePath, function(dir){
        return dir === 'node_modules';
    });
}

function isFileOf(filePath, ofWhat) {
    var parts = filePath.split(path.sep);
    for(var i = parts.length; i--;) {
        if (ofWhat(parts[i])) {
            return true;
        }
    }

    return false;
}

function nodeExists(aem, filePath){
    return aem.getNode(filePath)
        .then(function(){
            return true;
        }, function(err) {
            if (err && err.response.status !== 404) {
                return Promise.reject(err);
            }

            return false;
        });
}

function readXML(absPath) {
    return Promise.resolve()
        .then(function(){
            return new Promise(function(rs, rj) {
                fs.readFile(absPath, 'utf8', function (err, data) {
                    if (err) {
                        rj(err);
                    }
                    else {
                        rs(data);
                    }
                });
            });
        })
        .then(function(data){
            return new Promise(function(rs, rj){
                console.log(`parsing ${absPath}...`);
                xml2js.parseString(data, function(err, doc){
                    if (err) {
                        rj(err);
                    }
                    else {
                        rs(doc);
                    }
                });
            });
        });
}

function getNodePrimaryType(filePath) {
    var absPath = getAbsPath(filePath);
    var absContentPath = path.join(absPath, FILE_DOT_CONTENT_XML);
    var exists = fs.existsSync(absContentPath);
    var promise = Promise.resolve();

    if (exists) {
        console.log('Found potential primary type settings, try reading...');
        promise = readXML(absContentPath)
            .then(function(doc){
                if (!doc) {
                    return;
                }

                var root = doc['jcr:root'];

                if (!root.$) {
                    return;
                }

                var primaryType = root.$['jcr:primaryType'];
                return primaryType;
            });
    }
    
    return promise.then(function(primaryType){
        return primaryType || 'nt:folder';
    });
}

function createFolders(aem, filePath) {
    var dirPath = path.dirname(filePath);
    var dirnames = dirPath.split(path.sep);
    // shift starting '/'
    dirnames.shift();
    var i = 0;

    function create(index) {
        var current = '/' + dirnames.slice(0, index + 1).join(path.sep);
        console.log(`Check if ${current} exists...`);
        return nodeExists(aem, current)
            .then(function(isExist){
                if (isExist) {
                    console.log('It does, move on');    
                }
                else {
                    console.log(`Creating ${current}...`);
                    return getNodePrimaryType(current)
                        .then(function(primaryType){
                            console.log(`as ${primaryType}...`);
                            return aem.createNode(current, primaryType);
                        });
                }
            });
    }

    function loop(){
        return create(i)
            .then(function(){
                i++;
                if (i < dirnames.length) {
                    return loop();
                }
            });
    }
    return loop();
}

function getAbsPath(filePath) {
    return path.join(process.cwd(), args.base, filePath);
}

function filterXMLAttributes(node){
    var ret = {};
    var filtered = ['jcr:created', 'jcr:createdBy', 'jcr:primaryType'];
    for(var key in node) {
        if (
            !node.hasOwnProperty(key) ||
            key.indexOf('xmlns:') === 0 ||
            filtered.indexOf(key) >= 0 ||
            (node[key][0] === '[' && node[key][node[key].length - 1] === ']') ||
            typeof node[key] === 'object'
        ) {
            // TODO
            continue;
        }
        ret[key] = node[key];
    }
    return ret;
}

function uploadFile(aem, filePath) {
    var absPath = getAbsPath(filePath);
    let jcrPath = path.join('/', filePath);
    console.log(`Uploading ${filePath} to ${jcrPath}...`);

    return createFolders(aem, jcrPath)
        .then(function(){
            return nodeExists(aem, jcrPath);
        })
        .then(function(isExist){
            if (isExist) {
                console.log('File is already there, removing it...');
                return aem.removeNode(jcrPath);
            }
        })
        .then(function(){
            return aem.createFile(jcrPath, absPath, null, 'application/octet-stream', true);
        });
}

function uploadPropertiesChange(aem, filePath) {
    var absPath = getAbsPath(filePath);
    var jcrPath = path.join('/', path.dirname(filePath));
    var xmlDoc;

    return Promise.resolve()
        .then(function(){
            return readXML(absPath);
        })
        .then(function(doc){
            xmlDoc = doc;
            return createFolders(aem, path.join(jcrPath, FILE_DOT_CONTENT_XML));
        })
        .then(function(){
            var propertiesChanges = xmlDoc && xmlDoc['jcr:root'] && xmlDoc['jcr:root'].$;
            propertiesChanges = filterXMLAttributes(propertiesChanges);

            if (Object.keys(propertiesChanges).length <= 0) {
                return;
            }

            console.log('Got property changes ', propertiesChanges);
            console.log(`Uploading property changes to "${jcrPath}"...`);

            return aem.setProperties(jcrPath, propertiesChanges);
        });
}

function createCQXMLTree(aem, filePath) {
    var basename = path.basename(filePath, '.xml');
    basename = basename.replace(/^_cq_/, 'cq:');
    var jcrPath = path.join('/', path.dirname(filePath), basename);
    return createXMLTree(aem, filePath, jcrPath);
}

function createDialogBox(aem, filePath) {
    var jcrPath = path.join('/', path.dirname(filePath), path.basename(filePath, '.xml'));
    return createXMLTree(aem, filePath, jcrPath);
}

function createXMLTree(aem, filePath, jcrPath) {
    var absPath = getAbsPath(filePath);
    var basename = path.basename(jcrPath);
    var root;

    console.log(`Creating xml tree for ${jcrPath}`);

    return Promise.resolve()
        .then(function(){
            return readXML(absPath);
        })
        .then(function(doc){
            root = doc && doc['jcr:root'];
            return createFolders(aem, jcrPath);
        })
        .then(function(){
            console.log(`Checking if ${basename} node exists...`);
            return nodeExists(aem, jcrPath);
        })
        .then(function(isExist){
            if (isExist) {
                console.log('It does exist, removing it...');
                return aem.removeNode(jcrPath);
            }
        })
        .then(function(){
            console.log('Recreating it...');
            return aem.createNode(jcrPath, root.$['cq:primaryType']);
        })

        .then(function(){
            console.log(`Start creating ${basename} tree...`);
            function traverse(curPath, node){
                var setPropertiesPromise;
                var props = filterXMLAttributes(node.$);
                
                if (Object.keys(props).length > 0) {
                    console.log(`Setting properties for ${curPath}...`, props);
                    setPropertiesPromise = aem.setProperties(curPath, props);
                }
                else {
                    setPropertiesPromise = Promise.resolve();
                }

                return setPropertiesPromise
                    .then(function(){
                        var promises = [];
                        var prevPromise = Promise.resolve();
                        for(var key in node) {
                            let subNodes = node[key];
                            let subPath = path.join(curPath, key);

                            if (!Array.isArray(subNodes) || key === '$') {
                                continue;
                            }

                            for(var i = 0; i < subNodes.length; i++) {
                                let subNode = subNodes[i];

                                console.log(`Found sub node ${key} ${i}`);
                                
                                prevPromise = prevPromise
                                    .then(function(){
                                        return nodeExists(aem, subPath);
                                    })
                                    .then(function(isExist){
                                        if (!isExist) {
                                            console.log('subNode', subNode);
                                            let type = subNode.$['jcr:primaryType'];
                                            console.log(`Creating sub node ${subPath} as ${type}`);
                                            return aem.createNode(subPath, type);
                                        }
                                    })
                                    .then(function(){
                                        return traverse(subPath, subNode);
                                    });

                                promises.push(prevPromise);
                            }
                        }

                        return Promise.all(promises);
                    });
            }

            return traverse(jcrPath, root);
        });
}

function sync() {
    var renamedFiles = [];

    if (!fs.existsSync(args.base)) {
        console.log(`Base folder ${args.base} doesn't exist`);
        return;
    }

    console.log(`Start syncing on ${args.base}`);

    var aem = new AEM(`${args.protocol}://${args.host}`, args.port, args.username, args.password);
    var fullbasePath = path.join(process.cwd(), args.base);

    fs.watch(fullbasePath, {
        recursive: true
    }, function(verb, filePath){
        filePath = path.normalize(filePath);
        var basename = path.basename(filePath);
        var absPath = getAbsPath(filePath);

        // ignore git files
        if (isGitFile(filePath)) {
            return;
        }

        if (isInsideNodeModuleFolder(filePath) || basename === 'node_modules') {
            return;
        }

        // double check if that file is exist, in case file gets renamed or deleted
        if (!fs.existsSync(absPath)) {
            renamedFiles.push(filePath);
            if (renamedFiles.length > 1024) {
                renamedFiles.shift();
            }
            return;
        }

        var stat = fs.statSync(absPath);

        // only upload file not dir
        if (!stat.isFile()) {
            return;
        }

        console.log(compromise(`${filePath} ${verb}`, lexcicon).sentences().toPastTense().out('text'));

        (function(){
            if (basename.indexOf('_cq_') === 0){
                console.log('CQ File is detected.');
                return createCQXMLTree(aem, filePath);
            }
            else if (basename === FILE_DOT_CONTENT_XML) {
                console.log('Property change is detected.');
                return uploadPropertiesChange(aem, filePath);
            }
            else if (basename === 'dialog.xml') {
                console.log('Dialog box config change is detected.');
                return createDialogBox(aem, filePath);
            }
            else if (basename.indexOf('.') === 0) {
                // ignore all the other hidden file
                return Promise.resolve();
            }
            else {
                return uploadFile(aem, filePath);
            }
        })()
            .then(function(){
                console.log(`${filePath} is uploaded`);
            }, function(err){
                console.log(`${filePath} uploading is failed with error: ${err}`);
            });

    });
}

function main() {
    if (command === 'sync') {
        sync();
    }
    else {
        console.log('No command found.');
    }
}

main();