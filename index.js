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
var uploadProcesses = {};

function red(msg) {
    return `\x1b[31m${msg}\x1b[0m`;
}

function yellow(msg) {
    return `\x1b[33m${msg}\x1b[0m`;
}

function getClosestSharedParent(dir0, dir1) {
    var dirs = {};
    dirs[0] = dir0.split('/');
    dirs[1] = dir1.split('/');
    var ret = '';

    dirs[0].unshift();
    dirs[1].unshift();

    for (var i = 0; i < dirs[0].length; i++) {
        if (i >= dirs[1].length) {
            break;
        }

        if (dirs[0][i] === dirs[1][i]) {
            ret += (ret ==='' ? dirs[0][i] : '/' + dirs[0][i]);
        }
        else {
            break;
        }
    }

    return '/' + ret;
}

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

function createFolders(aem, jcrPath) {
    var dirPath = path.dirname(jcrPath);
    var dirnames = dirPath.split(path.sep);
    var filePath = jcrPath.substr(1);
    // shift starting '/'
    dirnames.shift();
    var i = 0;
    var safeFolderFilePath = '/';

    function create(index) {
        var current = '/' + dirnames.slice(0, index + 1).join(path.sep);
        console.log(`Check if ${current} exists...`);
        return nodeExists(aem, current)
            .then(function(isExist){
                if (isExist) {
                    console.log(`${current} exists, move on`);
                    safeFolderFilePath = current;
                }
                else {
                    console.log(`${current} doesn't exist,`,
                        `send a partially off signal and creating ${current}...`);
                    return signalPartialOff(aem, filePath, safeFolderFilePath)
                        .then(function(){
                            return getNodePrimaryType(current); 
                        })
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

const TYPE_NUMBERS = ['Long', 'Double', 'Decimal'];

function convertType(value) {
    var ret = value;
    var found = false;

    for(var i = 0; i < TYPE_NUMBERS.length; i++) {
        let typeString = '{'+TYPE_NUMBERS[i]+'}';
        if (ret.indexOf(typeString) !== 0) {
            continue;
        }

        ret = ret.replace(typeString, '') * 1;
        found = true;
        break;
    }

    if (found == false) {
        ret = ret.replace(/^\{.*?\}/, '');
    }

    return ret;
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
        ret[key] = convertType(node[key]);
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
    var jcrPath = path.join('/', path.dirname(filePath));

    return createXMLTree(aem, filePath, jcrPath);
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
            return aem.createNode(jcrPath, root.$['jcr:primaryType']);
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

function waitUntilSafe(aem, filePath) {
    var sharedFolderFilePath;

    console.log('Check if it is safe to proceed ahead with filePath:', filePath);

    for(var key in uploadProcesses) {
        if (!uploadProcesses.hasOwnProperty(key)) {
            continue;
        }

        let processInfo = uploadProcesses[key];

        sharedFolderFilePath = getClosestSharedParent(processInfo.filePath, filePath);

        if (sharedFolderFilePath) {
            let subscriber = {
                filePath: filePath,
                sharedFolderFilePath: sharedFolderFilePath,
                resolve: null
            };
            let promise = new Promise(function(resolve){
                subscriber.resolve = resolve;
                processInfo.promise
                    .then(resolve);
            });
            processInfo.subscribers.push(subscriber);

            console.log(`Not safe, process "(${processInfo.filePath})"`,
                `shares same parent folder(${sharedFolderFilePath}) is found,`,
                'waiting for safe signal...');

            return promise
                .then(function(){
                    console.log(`safe signal received ${processInfo.filePath}, go ahead...`);
                    return waitUntilSafe(aem, filePath);
                });
        }
    }

    console.log('Safe, go ahead!');
    return Promise.resolve();
}

function signalOn(aem, filePath) {
    var signal = uploadProcesses[filePath];

    if (!signal) {
        console.log(`Set signal on for ${filePath}.`);
        signal = {
            filePath: filePath,
            promise: null,
            resolve: null,
            subscribers: []
        };
        uploadProcesses[filePath] = signal;

        signal.promise = new Promise(function(resolve){
            signal.resolve = resolve;
        });
    }

    return Promise.resolve();
}

function signalPartialOff(aem, filePath, safeFolderFilePath) {
    var signal = uploadProcesses[filePath];

    if (!signal) {
        console.log(red(`signal for ${filePath} cannot be found`));
        return Promise.reject('Something wrong, ' + 
            'no signal object was found while tryinig to send safe signal...');
    }

    for(var i = 0; i < signal.subscribers.length; i++) {
        let subscriber = signal.subscribers[i];
        let sharedFolderFilePath = getClosestSharedParent(subscriber.sharedFolderFilePath, safeFolderFilePath);
        if (sharedFolderFilePath != null && sharedFolderFilePath.length >= subscriber.sharedFolderFilePath) {
            console.log(`Firing a partial safe signal for ${subscriber.filePath}`);
            subscriber.resolve();
        }
    }

    return Promise.resolve();
}

function signalOff(aem, filePath) {
    var signal = uploadProcesses[filePath];

    if (signal) {
        delete uploadProcesses[filePath];
        console.log(`Firing a complete safe signal for ${filePath}`);
        signal.resolve();
    }

    return Promise.resolve();
}

function runSafe(aem, filePath, callback) {
    return waitUntilSafe(aem, filePath)
        .then(function(){
            return signalOn(aem, filePath);
        })
        .then(function(){
            return callback(aem, filePath);
        })
        .then(function(){
            return signalOff(aem, filePath);
        }, function(err){
            console.log(red('`runSafe` method caught an exception'));
            return signalOff(aem, filePath)
                .then(function(){
                    return Promise.reject(err);
                });
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
        var stat;

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

        try {
            stat = fs.statSync(absPath);
        }
        catch(ex){
            return;
        }

        // only upload file not dir
        if (!stat.isFile()) {
            return;
        }

        console.log(compromise(`${filePath} ${verb}`, lexcicon).sentences().toPastTense().out('text'));

        (function(){
            if (basename.indexOf('_cq_') === 0){
                console.log('CQ File is detected.');
                return runSafe(aem, filePath, createCQXMLTree);
            }
            else if (basename === FILE_DOT_CONTENT_XML) {
                console.log('Property change is detected.');
                return runSafe(aem, filePath, uploadPropertiesChange);
            }
            else if (basename.endsWith('.xml')) {
                console.log('Dialog box config change is detected.');
                return runSafe(aem, filePath, createDialogBox);
            }
            else if (basename.indexOf('.') === 0) {
                // ignore all the other hidden file
                return Promise.resolve();
            }
            else {
                return runSafe(aem, filePath, uploadFile);
            }
        })()
            .then(function(){
                console.log(`File: ${filePath} is uploaded`);
            }, function(err){
                console.log(red(`File: ${filePath} uploading is failed with error: ${err}`));
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