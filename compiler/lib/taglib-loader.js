var fs = require('fs');
var ok = require('assert').ok;
var nodePath = require('path');
var Taglib = require('./Taglib');
var cache = {};
var forEachEntry = require('raptor-util').forEachEntry;

function removeDashes(str) {
    return str.replace(/-([a-z])/g, function (match, lower) {
        return lower.toUpperCase();
    });
}

function invokeHandlers(config, handlers, path) {
    if (!config) {
        throw new Error('"config" argument is required');
    }

    if (typeof config !== 'object') {
        throw new Error('Object expected for ' + path);
    }



    for (var k in config) {
        if (config.hasOwnProperty(k)) {
            var value = config[k];
            k = removeDashes(k);
            var handler = handlers[k];
            if (!handler) {
                throw new Error('Invalid option of "' + k + '" for ' + path + '. Allowed: ' + Object.keys(handlers).join(', '));
            }
            try {
                handler(value);    
            }
            catch(e) {
                if (!e.invokeHandlerError) {
                    var error = new Error('Error while applying option of "' + k + '" for ' + path + '. Exception: ' + (e.stack || e));
                    error.invokeHandlerError = e;
                    throw error;
                }
                else {
                    throw e;
                }
            }
        }
    }

    if (handlers._end) {
        try {
            handlers._end(); 
        }
        catch(e) {
            if (!e.invokeHandlerError) {
                var error = new Error('Error for option ' + path + '. Exception: ' + (e.stack || e));
                error.invokeHandlerError = e;
                throw error;
            }
            else {
                throw e;
            }
        }
    }
}

function buildAttribute(attr, attrProps, path) {
    invokeHandlers(attrProps, {
        type: function(value) {
            attr.type = value;
        },
        targetProperty: function(value) {
            attr.targetProperty = value;
        },
        defaultValue: function(value) {
            attr.defaultValue = value;
        }
    }, path);

    return attr;
}

function buildTag(tagObject, path, taglib, dirname) {
    ok(tagObject);
    ok(typeof path === 'string');
    ok(taglib);
    ok(typeof dirname === 'string');

    var tag = new Taglib.Tag(taglib);

    invokeHandlers(tagObject, {
        renderer: function(value) {
            var path = nodePath.resolve(dirname, value);
            if (!fs.existsSync(path)) {
                throw new Error('Renderer at path "' + path + '" does not exist.');
            }
                    
            tag.renderer = path;
        },
        template: function(value) {
            var path = nodePath.resolve(dirname, value);
            if (!fs.existsSync(path)) {
                throw new Error('Template at path "' + path + '" does not exist.');
            }
                    
            tag.template = path;
        },
        attributes: function(value) {
            forEachEntry(value, function(attrName, attrProps) {
                var parts = attrName.split(':');
                var namespace = null;
                var localName = null;

                if (parts.length === 2) {
                    namespace = parts[0];
                    localName = parts[1];
                } else if (parts.length === 1) {
                    localName = attrName;
                } else {
                    throw new Error('Invalid attribute name: ' + attrName);
                }

                
                var attr = new Taglib.Attribute(namespace, localName);

                if (attrProps == null) {
                    attrProps = {
                        type: 'string'
                    };
                }
                else if (typeof attrProps === 'string') {
                    attrProps = {
                        type: attrProps
                    };
                }

                buildAttribute(attr, attrProps, '"' + attrName + '" attribute as part of ' + path);

                tag.addAttribute(attr);

            });
        },
        transformer: function(value) {
            var transformer = new Taglib.Transformer();

            

            if (typeof value === 'string') {
                value = {
                    path: value
                };
            }

            invokeHandlers(value, {
                path: function(value) {
                    var path = nodePath.resolve(dirname, value);
                    if (!fs.existsSync(path)) {
                        throw new Error('Transformer at path "' + path + '" does not exist.');
                    }

                    transformer.path = path;
                },

                before: function(value) {
                    transformer.before = value;
                },

                after: function(value) {
                    transformer.after = value;
                },

                name: function(value) {
                    transformer.name = value;
                }

            }, 'transformer in ' + path);

            ok(transformer.path, '"path" is required for transformer');

            tag.addTransformer(transformer);
        },
        var: function(value) {
            var varName = value;
            tag.addNestedVariable({
                name: varName
            });
        },
        importVar: function(value) {
            var importedVar = {};
            
            if (typeof value === 'string') {
                importedVar = {
                    targetProperty: value,
                    expression: value
                };
            }
            else {
                invokeHandlers(value, {
                    targetProperty: function(value) {
                        importedVar.targetProperty = value;
                    },

                    expression: function(value) {
                        importedVar.expression = value;
                    },

                    name: function(value) {
                        importedVar.expression = value;
                    },

                    _end: function() {
                        if (importedVar.name) {
                            if (!importedVar.targetProperty) {
                                importedVar.targetProperty = importedVar.name;
                            }
                            importedVar.expression = importedVar.name;
                            delete importedVar.name;
                        }
                        if (!importedVar.targetProperty) {
                            throw new Error('The "target-property" attribute is required for an imported variable');
                        }
                        if (!importedVar.expression) {
                            throw new Error('The "expression" attribute is required for an imported variable');
                        }
                    }

                }, 'import-var in ' + path);
            }

            tag.addImportedVariable(importedVar);
        }
    }, path);

    return tag;
}

function load(path) {
    if (cache[path]) {
        return cache[path];
    }

    var src = fs.readFileSync(path, {encoding: 'utf8'});
    var taglib = new Taglib(path);
    var dirname = nodePath.dirname(path);

    function handleNS(ns) {
        if (Array.isArray(ns)) {
            ns.forEach(function(ns) {
                taglib.addNamespace(ns);
            });
        }
        else {
            taglib.addNamespace(ns); 
        }
    }

    invokeHandlers(JSON.parse(src), {
        'namespace': handleNS,
        'namespaces': handleNS,
        'tags': function(tags) {
            forEachEntry(tags, function(tagName, path) {
                ok(path, 'Invalid tag definition for "' + tagName + '"');
                var tagObject;

                var tagDirname;

                if (typeof path === 'string') {
                    path = nodePath.resolve(dirname, path);
                    tagDirname = nodePath.dirname(path);
                    if (!fs.existsSync(path)) {
                        throw new Error('Tag at path "' + path + '" does not exist. Taglib: ' + taglib.id);
                    }

                    var tagJSON = fs.readFileSync(path, {encoding: 'utf8'});

                    try {
                        tagObject = JSON.parse(tagJSON);
                    }
                    catch(e) {
                        throw new Error('Unable to parse tag JSON for tag at path "' + path + '"');
                    }
                }
                else {
                    tagDirname = dirname; // Tag is in the same taglib file
                    tagObject = path;
                    path = '<' + tagName + '> tag in ' + taglib.id;
                }
                

                var tag = buildTag(tagObject, path, taglib, tagDirname);
                tag.name = tagName;

                taglib.addTag(tag);
            });
        }
    }, path);

    taglib.id = path;

    cache[path] = taglib;

    return taglib;
}

function loadTaglibXml(taglibXml, path) {
    var TaglibXmlLoader = require('./TaglibXmlLoader');
    var taglib = TaglibXmlLoader.load(taglibXml, path);
    taglib.id = path;
    return taglib;
}

function loadTaglibXmlFromFile(path) {
    var src = fs.readFileSync(path, {encoding: 'utf8'});
    return loadTaglibXml(src, path);
}

exports.load = load;
exports.loadTaglibXml = loadTaglibXml;
exports.loadTaglibXmlFromFile = loadTaglibXmlFromFile;