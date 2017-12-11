#!/usr/bin/env node

var fs = require('fs');
var parseArgs = require('minimist');
var path = require('path').posix;
var compromise = require('compromise');
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

    function loop(rs){
        return create(i)
            .then(function(){
                i++;
                if (i < dirnames.length) {
                    return loop();
                }
            })
    }
    return loop();
}

function sync() {
    var renamedFiles = [];

    if (!fs.existsSync(args.base)) {
        console.log(`Base folder ${args.base} doesn't exist`);
        return;
    }

    console.log(`Start syncing on ${args.base}`);

    var aem = new AEM(`${args.protocol}://${args.host}`, args.port, args.username, args.password);

    fs.watch(args.base, {
        recursive: true
    }, function(verb, filename){
        filename = path.normalize(filename);
        var filenameFromWorkingDir = path.join(args.base, filename);

        // ignore hidden files
        if (filename.indexOf('.') === 0) {
            return;
        }

        // double check if that file is exist, in case file gets renamed or deleted
        if (!fs.existsSync(filenameFromWorkingDir)) {
            renamedFiles.push(filename);
            if (renamedFiles.length > 1024) {
                renamedFiles.shift();
            }
            return;
        }

        let stat = fs.statSync(filenameFromWorkingDir);

        // only upload file not dir
        if (!stat.isFile()) {
            return;
        }

        console.log(compromise(`${filename} ${verb}`, lexcicon).sentences().toPastTense().out('text'));

        let jcrPath = path.join('/', filename);
        console.log(`Uploading ${filename} to ${jcrPath}...`);

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
                return aem.createFile(jcrPath, filenameFromWorkingDir, null, 'application/octet-stream', true);
            })
            .then(function(){
                console.log(`${jcrPath} is uploaded`);
            }, function(err){
                console.log(`${jcrPath} uploading is failed with error: ${err}`);
            });
    });
}

function main() {
    if (command === 'sync') {
        sync();
    }
    else {
        console.log('No command found.')
    }
}

main();