const mongoose = require('mongoose');
const productSchema = new mongoose.Schema({
  id: { type: Number, unique: true, index: true }, slug: String, name: {type:String,required:true,trim:true},
  category: {type:String,required:true}, productType:String, occasions:[String], personalisationTypes:[String],
  personalised:Boolean, price:{type:Number,required:true,min:0}, description:String, image:String, images:[String],
  availability:String, featured:Boolean, popularity:Number, dateAdded:String, stockStatus:String, tags:[String],
  active:{type:Boolean,default:true}
},{timestamps:true});
module.exports = mongoose.model('Product', productSchema);
