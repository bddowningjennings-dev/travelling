'use strict';

const Group = require('./models/group');
const User = require('./models/user');

const crypto = require('../utils/cryptointerface');
const config = require('../utils/config');
const Email = require('../utils/email');

class Database {
    constructor() {
    }

    static async checkAuth(name, email, password) {

        name = name.toLowerCase();

        var user = await User.findLimtedBy({username: name, email: email}, 'OR', 1);

        //No user found
        if (user == null || user.length == 0) {
          throw {
              user: null,
              err: {
                  type: 'user',
                  msg: 'invalid username or email'
              }
          };
        }

        // Regenerate new email with token for activation
        if(user.email_verify_token != null && user.locked) {
          var token = await Email.getActivationToken();
          user.email_verify_token = token.secret;
          await Email.sendActivation(user, user.email,token.token)
        }


        //Locked check
        user = user[0];
        if (user.locked) {
            throw {
                user: user,
                err: {
                    type: 'locked',
                    msg: user.locked_reason
                }
            };
        }

        //Password check
        if (user.password == await crypto.hash(password)) {
            user.failed_login_attempts = 0;
            await user.save();
            user.addProperty('group',await Group.findById(user.group_id))

            return {user, err: null};
        }

        //Failed login
        user.failed_login_attempts += 1;
        if (config.login.maxLoginAttempts && user.failed_login_attempts >= config.login.maxLoginAttempts && !user.locked) {
            user.locked = true;
            user.locked_reason = 'Failed login attempts exceeded the limit. Contact your admin to get your account unlocked.';
            await user.save();
            throw {
                user: user,
                err: {
                    type: 'locked',
                    msg: user.locked_reason
                }
            };
        }

        await user.save();
        throw {
            user: user,
            err: {
                type: 'password',
                msg: 'invalid password'
            }
        };

    }

    static async createAccount(username, password, email, group_id) {
        var userProp = {
            change_username: false,
            change_password: false,
            username: username.toLowerCase(),
            password: password,
            email: email,
            created_on: Date.now(),
            group_id: group_id
        };

        if(config.registration.requireManualActivation) {
          userProp.locked = true;
          userProp.locked_reason = 'Activation Required, email your admin to get your account activated'
        }

        var user = await User.create(userProp);

        if(config.registration.requireEmailActivation) {
          user.locked = true;
          user.locked_reason = 'Activation Required, check your email for the activation link.'
          var token = await Email.getActivationToken();
          user.email_verify_token = token.secret;
          await Email.sendActivation(user, user.email,token.token)
          await user.save();
        }

        //user.addProperty('group',group[0])
        return user;
    }

    static async forgotPassword(email, ip) {
      var user = await User.findLimtedBy({email:email},'AND',1);
      if(user && user.length > 0) {
        user = user[0];

        var rt = await Email.getRecoveryToken();
        user.reset_password_token = rt.secret;

        await user.save();

        Email.sendPasswordRecovery(user, ip, user.email, rt.token);
      }
    }

    static async resetPassword(token, password) {
      var user = await User.findLimtedBy({reset_password_token:token},'AND',1);
      if(!user || user.length < 1) {
        return false;
      }

      user = user[0]
      user.password = password;
      user.reset_password_token = null;
      await user.save();
      return true;
    }

    static async activateAccount(token) {
      console.log(token)
      var user = await User.findLimtedBy({email_verify_token:token},'AND',1);
      if(!user || user.length < 1) {
        return false;
      }

      user = user[0]

      user.email_verify_token = null;
      user.locked = false;
      user.locked_reason = null;
      await user.save();
      return true;
    }



    static async getDefaultGroup() {
        return await Group.getDefaultGroup();
    }

    static async initGroups(router) {

        var grps = await Group.findAll();

        if (grps.length == 0) {
          // create default groups
          var anon = await Group.create({
            name: "anonymous",
            type: "group",
            allowed: [],
            is_default: false
          });
          anon.addRoute({
            route: config.portal.path+'*',
            host: config.portal.host,
            removeFromPath: config.portal.path.slice(0, -1)
          });
          anon.addRoute({
            route: '/travelling/api/v1/auth/*',
            host: null
          })
          anon.addRoute({
            route: '/travelling/api/v1/user/me/route/allowed',
            host: null,
            method: 'GET'
          });
          await anon.save();

          router.groups[anon.name] = this.groupInheritedMerge(anon, grps);

          var admin = await Group.create({
            name: "superadmin",
            type: "group",
            allowed: [],
            is_default: true
          })

          admin.addRoute({
            host: null,
            route: '/travelling/*'
          });
          await admin.save();

          router.groups[admin.name] = this.groupInheritedMerge(admin, grps);



          await router.updateGroupList();
          return true;
        }

    await router.updateGroupList();
    return false;
  }

  static groupInheritedMerge(group, groups) {
    var nallowed = group.allowed ? [...group.allowed] : [];

    if (group.inherited && group.inherited.length > 0) {
      if(!group.inheritedGroups){
        group.addProperty('inheritedGroups', [])
      }
      for (var i = 0; i < group.inherited.length; ++i) {
          for (var j = 0; j < groups.length; ++j) {
            if (groups[j].id == group.inherited[i].id) {
              group.inheritedGroups[i] = groups[j];
              break;
            }
          }
        nallowed.push(...this.groupInheritedMerge(group.inherited[i], groups));
      }
    }
    return nallowed;
  }
}

module.exports = Database;
