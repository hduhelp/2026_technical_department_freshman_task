<template>
  <view class="container">
    
    <view class="search-box">
      <input class="search-input" placeholder="输入物品名称搜索，如雨伞、校园卡" v-model="searchKey"/>
      <button class="search-btn" @click="search">搜索</button>
    </view>

    
    <view class="list-wrap">
      <view 
        class="item-card" 
        v-for="(item,idx) in showList" 
        :key="idx"
        @click="goDetail(item)"
      >
        <view class="item-img">
          <image :src="item.img" mode="aspectFill"></image>
        </view>
        <view class="item-info">
          <view class="item-name">{{item.name}}</view>
          <view>
            <text :class="item.type==='lost'?'tag-lost':'tag-found'">
              {{item.type==='lost'?'寻物':'招领'}}
            </text>
          </view>
          <view class="item-desc">{{item.desc}}</view>
          <view class="time-place">📍{{item.place}} | {{item.time}}</view>
        </view>
      </view>
      
      <view class="empty" v-if="showList.length === 0">
        没有找到匹配的物品
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      searchKey: "",
      
      allItemList: [
        {
          name:"黑色折叠雨伞",
          desc:"黑色长柄折叠伞，伞柄有划痕",
          place:"图书馆三楼自习区",
          time:"2026-10-01",
          type:"found",
          img:"/static/umbrella.jpg"
        },
        {
          name:"白色保温杯",
          desc:"带茶隔，浅蓝色杯盖",
          place:"食堂一楼",
          time:"2026-10-02",
          type:"lost",
          img:"/static/cup.jpg"
        },
        {
          name:"杭电校园卡",
          desc:"卡面印有校门图片",
          place:"教学楼A座201",
          time:"2026-10-03",
          type:"found",
          img:"/static/card.jpg"
        },
        {
          name:"蓝牙耳机",
          desc:"白色无线耳机，充电盒有磕碰",
          place:"二教走廊",
          time:"2026-10-04",
          type:"lost",
          img:"/static/earphone.jpg"
        }
      ],
      showList: []
    }
  },
  onLoad(){
    
    this.showList = [...this.allItemList]
  },
  methods:{
    search(){
      
      if(!this.searchKey.trim()){
        this.showList = [...this.allItemList]
        return
      }
      let key = this.searchKey.trim().toLowerCase()
      this.showList = this.allItemList.filter(item=>{
        return item.name.toLowerCase().includes(key)
      })
    },
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
.search-box{
  display:flex;
  gap:20rpx;
  margin-bottom:30rpx;
}
.search-input{
  flex:1;
  border:1rpx solid #ddd;
  padding:20rpx;
  border-radius:12rpx;
  background:#fff;
}
.search-btn{
  width:140rpx;
  background:#007aff;
  color:#fff;
}
.list-wrap{
  display:flex;
  flex-direction:column;
  gap:20rpx;
}
.item-card{
  background:#fff;
  border-radius:16rpx;
  display:flex;
  padding:20rpx;
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
.tag-lost{
  font-size:22rpx;
  color:#fff;
  background:#ff6b6b;
  padding:4rpx 12rpx;
  border-radius:20rpx;
}
.tag-found{
  font-size:22rpx;
  color:#fff;
  background:#409eff;
  padding:4rpx 12rpx;
  border-radius:20rpx;
}
.item-desc{
  font-size:24rpx;
  color:#666;
  margin:8rpx 0;
}
.time-place{
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