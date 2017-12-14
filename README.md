# b2c-sync 

Have you ever complained about the complex and slow process of synchronising local source code to your AEM server? Every time you modified a piece of component dialog box, sightly html file or `model.js` you will have to either build the whole project to get it uploaded into your AEM server or edit it in `/crx/de` manually which is prone to making errors. 

Not those hassle anymore! With this tool it will cover those chore for you seamlessly, it automatically detects the file changes on your local hard drive and upload them to the specified AEM server, not matter it is _cq_template.xml or dialog.xml or just plain javascript file. 

 (technically you can even sync your local code with QA server or live server, but that is not recommended, just saying...)

Interesting about it? Get it now by `npm install aem-sync`

Caveat: 

* Haven't tested it on window, use at your own discretion. 
* Do REMEMBER to STOP the sync before building the project, otherwise it will upload a ton of files to the AEM server and spifflicate the hopeless fragile AEM server.

## Installation

`npm install aem-sync -g`
`npm install "git+https://github.com/normanzb/aem-sync.git#v0.2.0" -g`

## Usage

Sync with local AEM server
```
b2c-sync sync --base path/to/your/jcr_root
```

Sync with custom settings
```
b2c-sync sync --base path/to/your/jcr_root --host remotehost --protocol https --port 4503 --username admin --password admin
```

## Bump version

`npm version major|minor|patch`

## Version

0.2.0