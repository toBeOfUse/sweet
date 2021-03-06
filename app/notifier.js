const webpush = require('web-push')
const User = require('./models/user')
const Community = require('./models/community')
const emailer = require('./emailer')

function markRead (userId, subjectId) {
  User.findOne({
    _id: userId
  }, 'notifications')
    .then(user => {
      user.notifications.forEach(notification => {
        if (!notification.seen && notification.subjectId === subjectId) {
          notification.seen = true
        }
      })
      user.save()
    })
}

function notify (type, cause, notifieeID, sourceId, subjectId, url, context) {
  function buildNotification () {
    switch (type) {
      case 'user':
        return User.findOne({ _id: sourceId })
          .then(user => {
            const notifTexts = {
              reply: 'replied to your post.',
              boost: 'boosted your post.',
              subscribedReply: 'replied to a post you have also replied to.',
              mentioningPostReply: 'replied to a post you were mentioned in.',
              boostedPostReply: 'replied to a post you boosted.',
              commentReply: 'replied to your comment.',
              mention: 'mentioned you in a ' + context + '.',
              relationship: 'now ' + context + 's you.'
            }
            const notifEmails = {
              mention: 'mentioned you on sweet 🙌'
            }
            const text = notifTexts[cause]
            const image = '/images/' + (user.imageEnabled ? user.image : 'cake.svg')
            const username = '@' + user.username
            const final = '<strong>' + username + '</strong> ' + text
            const emailText = notifEmails[cause] ? notifEmails[cause] : ''
            return {
              image: image,
              text: final,
              emailText: emailText
            }
          })
      case 'community':
        return User.findOne({ _id: sourceId })
          .then(user => {
            return Community.findOne({
              _id: subjectId
            })
              .then(community => {
                const commNotifTexts = {
                  request: '<strong>@' + user.username + '</strong> has asked to join <strong>' + community.name + '</strong>.',
                  requestResponse: 'Your request to join <strong>' + community.name + '</strong> has been ' + context + '.',
                  vote: 'A vote has been ' + context + ' in <strong>' + community.name + '</strong>.',
                  yourVote: 'Your vote has been ' + context + ' in <strong>' + community.name + '</strong>.',
                  management: '<strong>@' + user.username + '</strong> has been ' + context + ' from <strong>' + community.name + '</strong>.',
                  managementResponse: 'You have been ' + context + ' from <strong>' + community.name + '</strong>.',
                  nameChange: 'The name of the community <strong>' + context + '</strong> has been changed to <strong>' + community.name + '</strong>.'
                }
                const text = commNotifTexts[cause]
                const image = '/images/communities/' + (community.imageEnabled ? community.image : 'cake.svg')
                return {
                  image: image,
                  text: text
                }
              })
          })
    }
  }
  console.log('creating notification')
  User.findOne({
    _id: notifieeID
  })
    .then(notifiedUser => {
      buildNotification()
        .then(async response => {
          // send the user push notifications if they have a subscribed browser
          if (notifiedUser.pushNotifSubscriptions.length > 0) {
            for (const subbed of notifiedUser.pushNotifSubscriptions) {
              const pushSubscription = JSON.parse(subbed)
              const options = {
                gcmAPIKey: ''
              }
              const payload = JSON.stringify({
                body: response.text.replace(/<(\/)?strong>/g, ''),
                imageURL: response.image.replace('.svg', '.png'), // we can't use svgs here, which cake.svg (the default profile image) is, this will use cake.png instead
                link: url
              })
              webpush.sendNotification(pushSubscription, payload, options).catch(async err => {
                console.log('push notification subscription not working, will be removed:')
                console.log(err)
                notifiedUser.pushNotifSubscriptions = notifiedUser.pushNotifSubscriptions.filter(v => v !== subbed)
                notifiedUser = await notifiedUser.save()
              })
            }
          }
          // send the user an email if it's a mention and they have emails for mentions enabled
          if (notifiedUser.settings.sendMentionEmails === true && response.emailText) {
            emailer.sendSingleNotificationEmail(notifiedUser, response, url)
          }
          // if the most recent notification is a trust or follow, and the current is also a trust or follow from the same user, combine the two
          const lastNotif = notifiedUser.notifications[notifiedUser.notifications.length - 1]
          let notification
          if (
            lastNotif &&
            cause === 'relationship' &&
            lastNotif.category === 'relationship' &&
            lastNotif.url === url &&
            (
              (lastNotif.text.includes('follows you') && context === 'trust') ||
              (lastNotif.text.includes('trusts you') && context === 'follow'))
          ) {
            // It's too late at night to work out a better way to get the username of the new notification that isn't regexing the old notification, so... this will break at some point
            const username = lastNotif.text.match(/@[A-Za-z0-9-_]*/)
            console.log(username)
            notification = {
              category: cause,
              sourceId: sourceId,
              subjectId: subjectId,
              text: '<strong>' + username + '</strong> ' + 'now follows and trusts you.',
              image: response.image,
              url: url
            }
            notifiedUser.notifications[notifiedUser.notifications.length - 1] = notification
            notifiedUser.save().then(() => { console.log('notification sent to ' + notifiedUser.username) })
          } else {
            notification = {
              category: cause,
              sourceId: sourceId,
              subjectId: subjectId,
              text: response.text,
              image: response.image,
              url: url
            }
            notifiedUser.notifications.push(notification)
            notifiedUser.notifications = notifiedUser.notifications.slice(Math.max(0, notifiedUser.notifications.length - 60))
            notifiedUser.save().then(() => { console.log('notification sent to ' + notifiedUser.username) })
          }
        })
    })
    .catch(error => {
      console.error('could not send notification! type: ' + type + ' cause: ' + cause + ' context: ' + context)
      console.error(error)
    })
}

module.exports.markRead = markRead
module.exports.notify = notify
