import {createRequestHandler} from './service.js';
let lastEnv, handler;
export default {
  fetch(request,env) {
    if (env !== lastEnv) {handler=createRequestHandler({env,publicDeployment:true});lastEnv=env;}
    return handler(request);
  }
};
