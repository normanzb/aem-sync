# aem-watch 

Have you ever complained about the complex and slow process of synchronising local source code to your AEM server? Every time you modified a piece of component dialog box, sightly html file or `model.js` you will have to either build the whole project to get it uploaded into your AEM server or edit it in `/crx/de` manually which is prone to making errors. 

Not those hassle anymore! With this tool it will cover those chores for you seamlessly, it automatically detects the file changes on your local hard drive and upload them to the specified AEM server, not matter it is _cq_template.xml or dialog.xml or just plain javascript file. 

 (technically you can even sync your local code with QA server or live server, but that is not recommended, just saying...)

Interested about it? Get it now by `npm install aem-watch`

### Caveat: 

* Haven't tested it on window, use at your own discretion. 
* Do REMEMBER to STOP the sync before building the project, otherwise it will upload a ton of files and spifflicate the hopeless fragile AEM server.

## Installation

`npm install aem-watch -g`

`npm install "git+https://github.com/normanzb/aem-watch.git#v0.3.3" -g`

## Usage

Sync with local AEM server
```
aem-watch sync --base path/to/your/jcr_root
```

Sync with custom settings
```
aem-watch sync --base path/to/your/jcr_root --host remotehost --protocol https --port 4503 --username admin --password admin
```

## Bump version

`npm version major|minor|patch`

## Version

0.3.3

## Known issues

1. Property type is omitted when updating property as underlying API doesn't support setting propoerty type.
2. Conflict error will be thrown when setting existing node with a new cq:primaryType, you need to delete the node manually in order for aem-watch to recreate it with new primaryType. aem-watch will not delete the node automatically for you now as it requires re-uploading child nodes of newly created node which is un-intuitive.