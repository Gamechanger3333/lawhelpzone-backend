import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function fixLocationData() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: "lawhelpzone"
    });
    
    console.log('✅ MongoDB Connected');
    console.log('🔧 Fixing location data structure...');
    
    const db = mongoose.connection.db;
    
    // First, let's see how many documents have the wrong structure
    const wrongStructure = await db.collection('users').countDocuments({
      'location.coordinates.type': { $exists: true }
    });
    
    console.log(`📊 Found ${wrongStructure} documents with incorrect location structure`);
    
    if (wrongStructure === 0) {
      console.log('✨ All documents already have correct structure!');
      process.exit(0);
    }
    
    // Fix all users with invalid location structure
    const result = await db.collection('users').updateMany(
      {}, 
      {
        $set: {
          'location.type': 'Point',
          'location.coordinates': [0, 0]  // default [longitude, latitude]
        },
        $unset: {
          'location.coordinates.type': '',
          'location.coordinates.coordinates': ''
        }
      }
    );
    
    console.log(`✅ Modified ${result.modifiedCount} documents`);
    
    // Verify the fix by checking a sample user
    const sampleUser = await db.collection('users').findOne({ 
      email: 'raziasarwarf44@gmail.com' 
    });
    
    if (sampleUser) {
      console.log('\n📋 Sample user verification:');
      console.log('Email:', sampleUser.email);
      console.log('Location structure:', JSON.stringify(sampleUser.location, null, 2));
      
      // Verify it's correct
      if (sampleUser.location?.type === 'Point' && 
          Array.isArray(sampleUser.location?.coordinates) &&
          sampleUser.location.coordinates.length === 2) {
        console.log('✅ Location structure is now correct!');
      } else {
        console.log('⚠️  Location structure may still have issues');
      }
    }
    
    // Check all documents one more time
    const stillWrong = await db.collection('users').countDocuments({
      'location.coordinates.type': { $exists: true }
    });
    
    if (stillWrong === 0) {
      console.log('\n🎉 All location data has been successfully fixed!');
    } else {
      console.log(`\n⚠️  ${stillWrong} documents may still need manual fixing`);
    }
    
    console.log('\n🔄 Please restart your server now.');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fixing location data:', error);
    process.exit(1);
  }
}

// Run the fix
fixLocationData();