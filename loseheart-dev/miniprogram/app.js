App({globalData:{user:null,drafts:{},preserveDrafts:false},onLaunch(){this.globalData.user=wx.getStorageSync('user')||null}})
