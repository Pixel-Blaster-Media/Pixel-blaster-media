import {readFileSync} from 'node:fs';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {loadSource} from './source-module.mjs';
export const galleryData=JSON.parse(readFileSync(new URL('../../lib/booking/website-galleries.generated.json',import.meta.url),'utf8'));
export const websiteGalleries=loadSource('lib/booking/website-galleries.ts',{'./website-galleries.generated.json':{default:galleryData}});
export const WebsiteGalleryDialog=loadSource('components/WebsiteGalleryDialog.tsx',{
 react:React,'react/jsx-runtime':jsxRuntime,'./website-gallery.css':{},
}).default;
export const galleryDependencies={
 '@/lib/booking/website-galleries':websiteGalleries,
 '@/components/WebsiteGalleryDialog':{default:WebsiteGalleryDialog},
};
