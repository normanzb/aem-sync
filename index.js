#!/usr/bin/env node

var fs = require('fs');
var parseArgs = require('minimist');
var path = require('path').posix;
var compromise = require('compromise');
var xml2js = require('xml2js');
var AEM = require('aem-api');

const DIR_BASE = path.join('b2c-view', 'jcr_root');

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
    var parts = filePath.split(path.sep);
    for(var i = parts.length; i--;) {
        if (parts[i].indexOf('.git') === 0) {
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
                    return aem.createNode(current, 'nt:folder');
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
    var xmlString;

    return Promise.resolve()
        .then(function(){
            return new Promise(function(rs, rj) {
                fs.readFile(absPath, {
                    encoding: 'utf8'
                }, function(err, data){
                    if (err) {
                        rj(err);
                        return;
                    }
                    rs(data);
                });
            });
        })
        .then(function(data){
            xmlString = data;
            return createFolders(aem, path.join(jcrPath, '.content.xml'));
        })
        .then(function(){
            console.log('parsing .content.xml...');
            return new Promise(function(rs, rj){
                xml2js.parseString(xmlString, function(err, result){
                    if (err) {
                        rj(err);
                        return;
                    }
                    rs(result);
                });
            });
        })
        .then(function(root){
            var propertiesChanges = root && root['jcr:root'] && root['jcr:root'].$;

            propertiesChanges = filterXMLAttributes(propertiesChanges);
            console.log('Got property changes ');
            console.log(`Uploading property changes to "${jcrPath}"...`);

            return aem.setProperties(jcrPath, propertiesChanges);
        });
}

function createDialogBox(aem, filePath) {
    var absPath = getAbsPath(filePath);
    var jcrPath = path.join('/', path.dirname(filePath), path.basename(filePath, '.xml'));
    var xmlString;

    return Promise.resolve()
        .then(function(){
            return new Promise(function(rs, rj) {
                fs.readFile(absPath, {
                    encoding: 'utf8'
                }, function(err, data){
                    if (err) {
                        rj(err);
                        return;
                    }
                    rs(data);
                });
            });
        })
        .then(function(data){
            xmlString = data;
            return createFolders(aem, jcrPath);
        })
        .then(function(){
            console.log('Checking if dialog node exists...');
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
            return aem.createNode(jcrPath, 'cq:Dialog');
        })
        .then(function(){
            console.log('parsing dialog.xml...');
            return new Promise(function(rs, rj){
                xml2js.parseString(xmlString, function(err, result){
                    if (err) {
                        rj(err);
                        return;
                    }
                    rs(result);
                });
            });
        })
        .then(function(root){
            var tree = root && root['jcr:root'];

            console.log('Start creating dialog tree...');
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

            return traverse(jcrPath, tree);
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
            }
            else if (basename === '.content.xml') {
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