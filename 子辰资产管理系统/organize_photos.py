import os
import zipfile
import shutil
from datetime import datetime

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PHOTOS_DIR = os.path.join(BASE_DIR, 'photos_storage')
ZIP_DIR = BASE_DIR  # Directory where exported ZIP files are located

# Ensure directories exist
def ensure_directories():
    if not os.path.exists(PHOTOS_DIR):
        os.makedirs(PHOTOS_DIR)
    
    # Create corner photos directory
    corner_photos_dir = os.path.join(PHOTOS_DIR, 'corner_photos')
    if not os.path.exists(corner_photos_dir):
        os.makedirs(corner_photos_dir)

# Organize photos from exported ZIP file
def organize_photos_from_zip():
    ensure_directories()
    
    # Find the latest exported ZIP file
    zip_files = [f for f in os.listdir(ZIP_DIR) if f.endswith('.zip') and 'zichen_asset_system_export' in f]
    if not zip_files:
        print('No exported ZIP file found')
        return
    
    # Sort by modification time, take the latest
    zip_files.sort(key=lambda x: os.path.getmtime(os.path.join(ZIP_DIR, x)), reverse=True)
    latest_zip = os.path.join(ZIP_DIR, zip_files[0])
    
    print(f'Processing: {latest_zip}')
    
    # Create temporary extraction directory
    temp_dir = os.path.join(BASE_DIR, 'temp_extract')
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir)
    
    try:
        # Extract ZIP file
        with zipfile.ZipFile(latest_zip, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        # Traverse extracted folders
        for item in os.listdir(temp_dir):
            item_path = os.path.join(temp_dir, item)
            
            # Process department folders
            if os.path.isdir(item_path) and not item.endswith('.xlsx'):
                dept_name = item
                dept_photo_dir = os.path.join(PHOTOS_DIR, dept_name)
                
                if not os.path.exists(dept_photo_dir):
                    os.makedirs(dept_photo_dir)
                
                # Copy department photos
                for photo_file in os.listdir(item_path):
                    if photo_file.endswith(('.jpg', '.jpeg', '.png', '.gif')):
                        src = os.path.join(item_path, photo_file)
                        dst = os.path.join(dept_photo_dir, photo_file)
                        
                        # Handle duplicate filenames
                        if os.path.exists(dst):
                            base, ext = os.path.splitext(photo_file)
                            counter = 1
                            while True:
                                new_name = f"{base}_{counter}{ext}"
                                new_dst = os.path.join(dept_photo_dir, new_name)
                                if not os.path.exists(new_dst):
                                    dst = new_dst
                                    break
                                counter += 1
                        
                        shutil.copy2(src, dst)
                        print(f'Copied: {photo_file} -> {dept_name}/')
        
        print('\nPhoto organization completed!')
        print(f'Photos saved to: {PHOTOS_DIR}')
        
    finally:
        # Clean up temporary directory
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

# Show photo storage status
def show_photos_status():
    ensure_directories()
    
    print('\n=== Photo Storage Status ===')
    
    # Count total photos
    total_photos = 0
    dept_counts = {}
    
    for root, dirs, files in os.walk(PHOTOS_DIR):
        # Skip corner photos directory
        if 'corner_photos' in root:
            continue
        
        dept_name = os.path.basename(root)
        if dept_name != 'photos_storage':
            photo_count = len([f for f in files if f.endswith(('.jpg', '.jpeg', '.png', '.gif'))])
            total_photos += photo_count
            dept_counts[dept_name] = photo_count
    
    print(f'Total photos: {total_photos}')
    print('Photos per department:')
    for dept, count in dept_counts.items():
        print(f'  {dept}: {count} photos')

if __name__ == '__main__':
    print('Zichen Asset Management System - Photo Organizer')
    print('=' * 40)
    
    # Organize photos
    organize_photos_from_zip()
    
    # Show status
    show_photos_status()
    
    print('\nUsage Instructions:')
    print('1. First export data in the system (generates ZIP file)')
    print('2. Run this script to automatically organize photos from ZIP')
    print('3. Photos will be stored by department in "photos_storage" folder')
