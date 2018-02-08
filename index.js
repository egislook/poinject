'use strict';

const uuid      = require('uuid/v4'),
      shortid   = require('shortid'),
      fs        = require('fs'),
      lodash    = require('lodash'),
      validator = require('validator');

let flatArr = [], pointree = {}, jsonFilePath, schemas = {
  url: {
    type: 'string',
    max: 2048,
    min: 1,
  },
  text: {
    type: 'string',
    min: 1,
    max: 2000,
  }
};

exports.jsonToPoinject = (object) => {
  pointree = toPoinject(object);
  return { pointree, object, flatArr};
}

let fileToObj = exports.fileToObj = (filePath) => {
  jsonFilePath = fs.existsSync(filePath) && filePath;
  let obj = jsonFilePath && require(filePath) || {};
  pointree = toPoinject(obj);
  return obj;
}

exports.fileToPoinject = (filePath) => {
  let obj = fileToObj(filePath);
  pointree = toPoinject(obj);
  obj.poinject = flatArr;
  return obj;
}

/** Gets poinjact object with its children */
exports.poinject = (path) => {
  if(!path)
    return flatArr;

  let ancestors = lodash.result(lodash.find(flatArr, { path }), 'ancestors');
  let ancestorsPath = ancestors.join('.child.') + '.child';
  return lodash.result(pointree, ancestorsPath);
}

exports.poinjectAll = () => ({ pointree, flatArr });

/** Transforms poinject flat array to standart JS object */
let json = exports.json = (path) => {
  let id = path && lodash.result(lodash.find(flatArr, { path }), 'parent');
  return toJson(id);
}

exports.createPoinjectValueByParent = (text, parent, type = 'field') => {
  if(!text) return;

  let extras;

  if(parent && lodash.find(flatArr, { parent, value: text }))
    return;

  if(parent){
    let parentField = lodash.find(flatArr, { id: parent });
    let ancestors = parentField.ancestors && parentField.ancestors.slice() || [];
    ancestors.push(parent);
    extras = {
      parent,
      ancestors,
      path: parentField.path && `${parentField.path}.${parentField.value}` || parentField.value
    };
  }

  //console.log(text, parent, extras);

  const leaf = type === 'field'
    ? fieldModel(getUID(), text, null, extras)
    : valueModel(getUID(), text, extras);

  // extras = {
  //   parent: field.id,
  //   path: `${extras.path}.${field.value}`,
  //   ancestors: extras.ancestors
  // };
  // extras.ancestors.push(field.id);
  //
  // const value = valueModel(getUID(), 'empty', extras);

  flatArr.unshift(leaf);

  return { poinject: flatArr, content: objToFile(jsonFilePath, json()), leaf }
}

exports.createChunkBySchema = (schemaPath, data) => {
  const schema = json(schemaPath);
  const invalid = validateDataBySchema(schema, data);
  const schemaName = schemaPath.split('.').pop();
  if(invalid)
    return invalid;

  let container = lodash.find(flatArr, { value: schemaName + 's', type: 'field'});

  if(!container){
    data = { [schemaName + 's']: {
      [getUID(schemaName)]: data
    }};

    const chunk = [];
    toPoinject(data, undefined, chunk);
    flatArr = flatArr.concat(chunk);
    return { poinject: flatArr, content: objToFile(jsonFilePath, json()), chunk }
  }

  if(container){
    data = { [getUID(schemaName)]: data };
    const chunk = [];
    toPoinject(data, { path: container.value, parent: container.id }, chunk);
    //console.log(chunk);
    flatArr = flatArr.concat(chunk);
    return { poinject: flatArr, content: objToFile(jsonFilePath, json()), chunk }
  }

  return {schema, data};
}

function validateDataBySchema(schema, data){
  for(let key in schema){
    let field = schema[key];
    let value = data[key];

    if(!field.type){
      let errObj = validateDataBySchema(field, value);
      if(errObj)
        return errObj;
    }

    if(field.required){
      if(!value)
        return { ok: false, msg: `required field "${key}" value "${value}" is incorrect`};

      if(['image', 'url'].indexOf(field.type) >= 0 && !validator.isURL(value, { require_host: false, require_valid_protocol: false }))
          return { ok: false, msg: `required field "${key}" value "${value}" must be URL`};

      if(!validator.isLength(value, { min: field.min, max: field.max }))
        return { ok: false, msg: `required field "${key}" value "${value}" must be between ${field.min} & ${field.max}`};

    } else {
      if(value && typeof value !== 'object' && !validator.isLength(value, { min: field.min, max: field.max }))
        return { ok: false, msg: `optional field "${key}" value "${value}" must be between ${field.min} & ${field.max}`};
    }
  }
}

exports.clonePoinjectById = (id) => {
  let leaf = lodash.find(flatArr, { id });
  let field = fieldModel(getUID(), `${leaf.value}-copy`, null, { ancestors: leaf.ancestors, path: leaf.path, parent: leaf.parent });

  flatArr.unshift(field);

  deepClone(leaf, field);

  function deepClone(origParent, newParent){
    let children = lodash.filter(flatArr, { parent: origParent.id });

    children.forEach((child) => {
      let ancestors = newParent.ancestors && newParent.ancestors.slice() || [];
      ancestors.push(newParent.id);
      let extras = {
        ancestors,
        path: newParent.path ? newParent.path + '.' + newParent.value : newParent.value,
        parent: newParent.id
      };

      let newLeaf = child.type === 'field'
        ? fieldModel(getUID(), child.value, null, extras)
        : valueModel(getUID(), child.value, extras)

      flatArr.push(newLeaf);

      if(newLeaf.type === 'field')
        return deepClone(child, newLeaf);
    })
  }

  return { poinject: flatArr, content: objToFile(jsonFilePath, json()), field };
}

/** Modifies value of given field or value id*/
exports.editPoinjectValueById = (id, value) => {
  if(!id || !value) return;

  let leaf = lodash.find(flatArr, { id });
  if(leaf.parent && lodash.find(flatArr, { parent: leaf.parent, value }))
    return;
    //throw new Error('id or value argument is not specified');
  let changed = [];
  flatArr = flatArr.map(obj => {
    if(obj.id === id){
      changed.push(obj);
      obj.value = value;
      return obj;
    }

    if(obj.ancestors){
      let index = obj.ancestors.indexOf(id);

      if(index < 0)
        return obj;

      let path = obj.path.split('.');
      path[index] = value;
      obj.path = path.join('.');
      changed.push(obj);
      return obj;
    }

    return obj;
  });

  return { poinject: flatArr, content: objToFile(jsonFilePath, json()), changed };
}

exports.movePoinjectToSiblingId = (id, siblingId) => {
  if(!id || !siblingId) return;

  let leafIndex = flatArr.findIndex(obj => obj.id === id);
  let siblingIndex = flatArr.findIndex(obj => obj.id === siblingId);

  flatArr[leafIndex] = Object.assign(flatArr[leafIndex], { parent: flatArr[siblingIndex].parent });
  flatArr.splice(siblingIndex, 0, flatArr.splice(leafIndex, 1)[0]);

  //if parent is not the same ancestors and paths has to be changed for children

  return { poinject: flatArr, content: objToFile(jsonFilePath, json()) }
}

exports.deletePoinjectValueById = (id) => {
  if(!id) return;

  let removed = [];
  flatArr = lodash.filter(flatArr, (leaf) => {

    if(leaf.id !== id && leaf.parent !== id
      && (!leaf.ancestors || leaf.ancestors && leaf.ancestors.indexOf(id) === -1) )
      return true;
    else{
      removed.push(leaf);
      return;
    }
  });

  return { poinject: flatArr, content: objToFile(jsonFilePath, json()), removed }
}
//
// exports.getTree = (idOrPath) => {
//
//   return json(idOrPath);
//   // function _deep(fields){
//   //   let obj = {};
//   //   for(let key in fields){
//   //     fields
//   //   }
//   // }
//   // return fields;
//   //console.log(fields);
// }

function objToFile(filePath, obj){
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
  return obj;
}

function toJson(id){
  let singleParent = id && lodash.find(flatArr, { id });
  let children = id
    ? lodash.filter(flatArr, { parent: singleParent.id })
    : lodash.filter(flatArr, obj => !obj.parent );

  /** single child means type: value */
  if(children && children.length === 1 && children[0].type === 'value')
    return children.shift().value;

  /** multiple children means type: field */
  let obj = {};
  children.forEach((child) => { obj[child.value] = toJson(child.id) });
  return obj;
}

function toPoinject(objOrStr, extraObj = {}, storage){
  let _UID, _child, _value, _childExtra, _children = {};

  /** for fields */
  if(typeof objOrStr === 'object'){
    const _keys = Object.keys(objOrStr);

    _keys.forEach((_key) => {
      _UID = getUID();
      let path      = extraObj.path       ? `${extraObj.path}.${_key}`  : _key;
      let ancestors = extraObj.ancestors  ? extraObj.ancestors.slice(0) : [];
      //let position  = extraObj.position   ? `${extraObj.position}a`     : 'a';
      ancestors.push(_UID);

      _childExtra = { parent: _UID, path, ancestors };
      _child = objOrStr[_key] && toPoinject(objOrStr[_key], _childExtra, storage);
      _children[_UID] = fieldModel(_UID, _key, _child, extraObj);

      /** global arr or obj */
      if(storage)
        storage.push(fieldModel(_UID, _key, null, extraObj));
      else
        flatArr && flatArr.push(fieldModel(_UID, _key, null, extraObj));
    });
    return _children;
  }

  /** for values */
  _value = valueModel(getUID(), objOrStr, extraObj);
  _children[_value.id] = _value;

  /** global arr or obj */
  if(storage)
    storage.push(_value)
  else
    flatArr && flatArr.push(_value);

  return _children;
}

function fieldModel(id, value, child, extras = { path: '', ancestors: [], parent: ''}){
  if(!id || !value) throw new Error('id or value argument is not specified');
  let field = Object.assign({ id, type: 'field', value }, extras, { child });
  child ? field = Object.assign(field, { child }) : 0;
  return field;
}

function valueModel(id, value, extras = {}){
  if(!id || !value) throw new Error('id or value argument is not specified');
  return Object.assign({ id, type: 'value', value }, extras);
}

function getUID(key){
  if(!key)
    return uuid();

  if(key === 'short')
    return shortid.generate();

  return `${key}-${new Date().getTime()}`;
}
