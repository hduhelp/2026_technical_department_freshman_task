<template>
  <view class="container">
    
    <view class="info-card">
      <view class="avatar">👤</view>
      <view class="info-text">
        <view class="name">学生姓名</view>
        <view class="desc">学工号：1000000000</view>
      </view>
    </view>

    
    <view class="tab-wrap">
      <view 
        class="tab-item" 
        :class="{active:currentTab === 'lost'}"
        @click="currentTab='lost'"
      >
        我发布的寻物
      </view>
      <view 
        class="tab-item" 
        :class="{active:currentTab === 'found'}"
        @click="currentTab='found'"
      >
        我发布的招领
      </view>
    </view>

    
    <view class="list-wrap">
      
      <view v-if="currentTab==='lost'">
        <view 
          class="item-card" 
          v-for="(item,idx) in myLostList" 
          :key="idx"
          @click="goDetail(item)"
        >
          <view class="item-img">
            <image :src="item.img" mode="aspectFill"></image>
          </view>
          <view class="item-info">
            <view class="item-name">{{item.name}}</view>
            <view class="item-desc">{{item.desc}}</view>
            <view class="time">📍{{item.place}} | {{item.time}}</view>
          </view>
        </view>
        <view class="empty" v-if="myLostList.length===0">暂无寻物信息</view>
      </view>

      
      <view v-if="currentTab==='found'">
        <view 
          class="item-card" 
          v-for="(item,idx) in myFoundList" 
          :key="idx"
          @click="goDetail(item)"
        >
          <view class="item-img">
            <image :src="item.img" mode="aspectFill"></image>
          </view>
          <view class="item-info">
            <view class="item-name">{{item.name}}</view>
            <view class="item-desc">{{item.desc}}</view>
            <view class="time">📍{{item.place}} | {{item.time}}</view>
          </view>
        </view>
        <view class="empty" v-if="myFoundList.length===0">暂无招领信息</view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      currentTab:"lost",
      
      myLostList:[
        {
          name:"白色保温杯",
          desc:"带茶隔，浅蓝色杯盖",
          place:"食堂一楼",
          time:"2026-10-02",
          type:"lost",
          img:"/static/cup.jpg"
        }
      ],
      
      myFoundList:[
        {
          name:"黑色折叠雨伞",
          desc:"黑色长柄折叠伞，伞柄有划痕",
          place:"图书馆三楼自习区",
          time:"2026-10-01",
          type:"found",
          img:"/static/umbrella.jpg"
        }
      ]
    }
  },
  methods:{
    goDetail(item){
      uni.navigateTo({
        url:`/pages/detail/detail?data=${encodeURIComponent(JSON.stringify(item))}`
      })
    }
  }
}
</script>

<style scoped>
.container{
  padding:40rpx;
  background-color:#f5f7fa;
  min-height:100vh;
}
.info-card{
  background:#fff;
  border-radius:16rpx;
  padding:40rpx;
  display:flex;
  align-items:center;
  margin-bottom:30rpx;
}
.avatar{
  width:100rpx;
  height:100rpx;
  background:#007aff;
  border-radius:50%;
  color:#fff;
  text-align:center;
  line-height:100rpx;
  font-size:40rpx;
  margin-right:30rpx;
}
.name{
  font-size:34rpx;
  font-weight:bold;
}
.desc{
  font-size:26rpx;
  color:#666;
  margin-top:8rpx;
}
.tab-wrap{
  display:flex;
  background:#fff;
  border-radius:12rpx;
  margin-bottom:30rpx;
}
.tab-item{
  flex:1;
  text-align:center;
  padding:24rpx;
  font-size:28rpx;
}
.tab-item.active{
  color:#007aff;
  font-weight:bold;
  border-bottom:4rpx solid #007aff;
}
.item-card{
  background:#fff;
  border-radius:16rpx;
  display:flex;
  padding:20rpx;
  margin-bottom:20rpx;
}
.item-img{
  width:140rpx;
  height:140rpx;
}
.item-img image{
  width:100%;
  height:100%;
  border-radius:12rpx;
}
.item-info{
  flex:1;
  margin-left:20rpx;
}
.item-name{
  font-size:30rpx;
  font-weight:bold;
}
.item-desc{
  font-size:24rpx;
  color:#666;
  margin:8rpx 0;
}
.time{
  font-size:22rpx;
  color:#999;
}
.empty{
  text-align:center;
  padding:80rpx 0;
  color:#999;
  font-size:26rpx;
}
</style>