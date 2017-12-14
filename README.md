# b2c-sync 

Automatically upload changed source code to remote AEM server.

## Installation

`npm install "ssh://git@bitbucket.eflabs.io:7999/sandiego/b2c-sync.git#v0.1.2" -g`

## Usage

Sync with default b2c settings
```
b2c-sync sync
```

Sync with custom settings
```
b2c-sync sync --host remotehost --protocol https --port 4503 --username admin --password admin
```

## Bump version

`npm version major|minor|patch`

## Version

0.1.2